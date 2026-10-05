"""Build a local signed/notarized release candidate, never publish or install it.

Without --execute this validates arguments and prints a plan. Signing identities,
notary credentials and Sparkle private keys remain in the user's Keychain.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import urllib.parse
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent

def run(*args, capture=False):
    return subprocess.run([str(arg) for arg in args], cwd=root, check=True,
                          text=True, stdout=subprocess.PIPE if capture else None).stdout

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New absolute directory for this candidate')
    parser.add_argument('--identity', required=True, help='Approved Developer ID Application identity in Keychain')
    parser.add_argument('--notary-profile', required=True, help='Existing notarytool Keychain profile')
    parser.add_argument('--sparkle-account', required=True, help='Existing Sparkle signing-key Keychain account')
    parser.add_argument('--public-key', required=True, help='Public Ed25519 update key, base64')
    parser.add_argument('--feed-url', required=True)
    parser.add_argument('--download-url', required=True, help='Exact future HTTPS URL of the final zip; no upload occurs')
    parser.add_argument('--execute', action='store_true', help='Explicitly sign and submit the candidate to Apple for notarization')
    args = parser.parse_args()
    assert args.output.is_absolute() and not args.output.exists(), 'Choose a new absolute candidate directory'
    assert args.identity.startswith('Developer ID Application: '), 'An approved Developer ID Application identity is required'
    assert len(base64.b64decode(args.public_key, validate=True)) == 32, 'Expected a public Ed25519 key'
    for raw in [args.feed_url, args.download_url]:
        url = urllib.parse.urlsplit(raw)
        assert url.scheme == 'https' and url.hostname and not url.username and not url.password and not url.fragment and not url.query, 'Release URLs must be fixed HTTPS URLs without credentials or tokens'
    version = json.loads((root / 'version.json').read_text())
    phases = ['build allowlisted unsigned app', 'configure HTTPS feed and public update key', 'sign Node with JIT entitlement',
              'refresh immutable payload inventory after signing', 'sign nested helpers and app with hardened runtime',
              'verify signatures', 'submit candidate zip to Apple notarization', 'require Accepted and retain notary log',
              'staple and validate app ticket', 'create final zip', 'sign archive using named Keychain account',
              'verify signature against embedded public key', 'write candidate appcast and provenance; do not upload or install']
    if not args.execute:
        print(json.dumps({'execution': False, 'version': version, 'phases': phases,
                          'qualification': 'Signing, JIT runtime, Gatekeeper, update paths and physical acceptance must be verified before publication.'}, indent=2))
        return
    assert version['channel'] != 'development', 'Select and review a release version/channel before signing a release candidate'
    assert not run('git', 'status', '--porcelain', '--untracked-files=normal', capture=True).strip(), 'Release candidates require a clean reviewed source checkout'
    os.umask(0o077); args.output.mkdir(mode=0o700)
    app = args.output / 'Contribution.app'
    run('bash', 'scripts/package-app.sh', app)
    info_path = app / 'Contents/Info.plist'; info = plistlib.loads(info_path.read_bytes())
    info.update(SUFeedURL=args.feed_url, SUPublicEDKey=args.public_key, SUEnableAutomaticChecks=False,
                SUAutomaticallyUpdate=False, SUAllowsAutomaticUpdates=False, SUSendProfileInfo=False)
    info_path.write_bytes(plistlib.dumps(info))
    payload = app / 'Contents/Resources/Engine'
    def sign(path, entitlements=None):
        command = ['/usr/bin/codesign', '--force', '--timestamp', '--options', 'runtime', '--sign', args.identity]
        if entitlements: command += ['--entitlements', str(entitlements)]
        run(*command, path)
    sign(payload / 'runtime/node', root / 'config/node-entitlements.plist')
    manifest_path = payload / 'manifest.json'; manifest = json.loads(manifest_path.read_text())
    manifest['distribution'] = 'signed-release'
    # Node's embedded code signature changes its bytes. Inventory the actual
    # final runtime before signing its enclosing app resource seal.
    for relative in manifest['files']:
        file = payload / relative
        assert file.is_file() and not file.is_symlink()
        manifest['files'][relative] = hashlib.sha256(file.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    run(payload / 'runtime/node', '--input-type=module', '-e',
        'const {verifyPayload}=await import(process.argv[1]); verifyPayload(process.argv[2]);',
        (payload / 'node_modules/@contribution/engine/dist/payload.js').as_uri(), payload)
    fw = app / 'Contents/Frameworks/Sparkle.framework/Versions/B'
    for relative in ['XPCServices/Downloader.xpc', 'XPCServices/Installer.xpc', 'Autoupdate', 'Updater.app']:
        sign(fw / relative)
    sign(app / 'Contents/Frameworks/Sparkle.framework')
    sign(app / 'Contents/Library/ContributionService'); sign(app / 'Contents/MacOS/contribution')
    sign(app)
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=2', app)
    run(payload / 'runtime/node', payload / 'node_modules/@contribution/cli/dist/main.js', 'version', '--json')
    submission = args.output / 'notarization-input.zip'
    run('/usr/bin/ditto', '-c', '-k', '--keepParent', app, submission)
    result = json.loads(run('/usr/bin/xcrun', 'notarytool', 'submit', submission, '--keychain-profile', args.notary_profile,
                            '--wait', '--output-format', 'json', capture=True))
    (args.output / 'notary-result.json').write_text(json.dumps(result, indent=2) + '\n')
    assert result.get('id'), 'Notary service did not return a submission identity'
    run('/usr/bin/xcrun', 'notarytool', 'log', result['id'], '--keychain-profile', args.notary_profile, args.output / 'notary-log.json')
    assert result.get('status') == 'Accepted', 'Notarization did not succeed; preserve and inspect the candidate diagnostics'
    run('/usr/bin/xcrun', 'stapler', 'staple', app); run('/usr/bin/xcrun', 'stapler', 'validate', app)
    run('/usr/sbin/spctl', '--assess', '--type', 'execute', '--verbose=2', app)
    archive = args.output / f"Contribution-{version['version']}-{version['build']}.zip"
    run('/usr/bin/ditto', '-c', '-k', '--keepParent', app, archive)
    signer = root / '.build/native/SourcePackages/artifacts/contributionplatform/Sparkle/bin/sign_update'
    signature = run(signer, '--account', args.sparkle_account, '-p', archive, capture=True).strip()
    run(root / '.tools/node/bin/node', 'scripts/verify-update-signature.mjs', archive, args.public_key, signature)
    ns = 'http://www.andymatuschak.org/xml-namespaces/sparkle'; ET.register_namespace('sparkle', ns)
    rss = ET.Element('rss', version='2.0'); channel = ET.SubElement(rss, 'channel')
    ET.SubElement(channel, 'title').text = 'Contribution'; ET.SubElement(channel, 'link').text = args.feed_url
    item = ET.SubElement(channel, 'item'); ET.SubElement(item, 'title').text = 'Contribution ' + version['version']
    ET.SubElement(item, f'{{{ns}}}version').text = version['build']; ET.SubElement(item, f'{{{ns}}}shortVersionString').text = version['version']
    ET.SubElement(item, f'{{{ns}}}minimumSystemVersion').text = '14.0'
    ET.SubElement(item, 'enclosure', {'url': args.download_url, 'length': str(archive.stat().st_size), 'type': 'application/octet-stream', f'{{{ns}}}edSignature': signature})
    ET.indent(rss); ET.ElementTree(rss).write(args.output / 'appcast-candidate.xml', encoding='utf-8', xml_declaration=True)
    (args.output / 'provenance.json').write_text(json.dumps({'version': version, 'sourceCommit': run('git', 'rev-parse', 'HEAD', capture=True).strip(),
        'archiveSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'sparkle': json.loads((root / 'config/sparkle.json').read_text()),
        'published': False, 'installed': False, 'qualification': 'Candidate only; review notary warnings and qualify actual update paths before publishing.'}, indent=2) + '\n')
    print('Signed candidate prepared locally. No feed was published and no application was installed.')

if __name__ == '__main__': main()
