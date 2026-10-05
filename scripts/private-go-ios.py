"""Apply the private transport overlay to a disposable checksum-verified source copy."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def apply(source):
    source = Path(source).resolve()
    if not source.is_relative_to((ROOT / '.build/go/tmp').resolve()) or not (source / 'go.mod').is_file():
        raise SystemExit('Only a disposable source copy under .build/go/tmp may receive this overlay.')
    changes = {}

    def edit(name, replacements):
        path = source / name
        before = path.read_text()
        after = before
        for old, new, count in replacements:
            if after.count(old) != count:
                raise SystemExit('Pinned private transport seam changed: ' + name)
            after = after.replace(old, new)
        changes[name] = {'before': hashlib.sha256(before.encode()).hexdigest(), 'after': hashlib.sha256(after.encode()).hexdigest()}
        path.write_text(after)

    # Control HTTP is retained only as an internal protocol over an authenticated
    # private Unix socket. No unauthenticated network control listener is started.
    api = (source / 'ios/tunnel/tunnel_api.go').read_text()
    start = api.index('func RunAgent(')
    end = api.index('// ServeTunnelInfo', start)
    old_agent = api[start:end]
    edit('ios/tunnel/tunnel_api.go', [
        ('\t"os/exec"\n', '', 1),
        (old_agent, 'func RunAgent(mode string, args ...string) error {\n\treturn fmt.Errorf("Contribution requires an explicitly owned backend session; automatic agent startup is disabled")\n}\n\n', 1),
        ('http.ListenAndServe(net.JoinHostPort(host, fmt.Sprintf("%d", port)), tunnelInfoMux(tm))', 'ios.ContributionServeControl(tunnelInfoMux(tm))', 1),
        ('var netClient = &http.Client{\n', 'var netClient = &http.Client{\n\tTransport: ios.ContributionControlTransport(),\n', 1),
        ('c := http.Client{\n', 'c := http.Client{\n\t\tTransport: ios.ContributionControlTransport(),\n', 3),
    ])
    edit('ios/tunnel/userspace_tunnel.go', [
        ('func ConnectUserSpaceTunnelLockdown(device ios.DeviceEntry, ifacePort int) (Tunnel, error) {\n', 'func ConnectUserSpaceTunnelLockdown(device ios.DeviceEntry, ifacePort int) (Tunnel, error) {\n\tif _, err := ios.ContributionSessionSecret(); err != nil { return Tunnel{}, err }\n', 1),
        ('net.Listen("tcp", fmt.Sprintf("localhost:%d", ifacePort))', 'ios.ContributionPrivateListener(ifacePort)', 1),
    ])
    edit('ios/connect.go', [
        ('\tconn, err := DialTunnelTCP(fmt.Sprintf("%s:%d", d.UserspaceTUNHost, d.UserspaceTUNPort))', '\tif d.UserspaceTUNHost != "127.0.0.1" && d.UserspaceTUNHost != "localhost" { return nil, fmt.Errorf("Contribution userspace proxy must be local") }\n\tconn, err := DialTunnelTCP(fmt.Sprintf("%s:%d", d.UserspaceTUNHost, d.UserspaceTUNPort))', 1),
        ('\t\treturn nil, fmt.Errorf("ConnectUserSpaceTunnel: failed to dial: %w", err)\n\t}\n', '\t\treturn nil, fmt.Errorf("ConnectUserSpaceTunnel: failed to dial: %w", err)\n\t}\n\tif err := ContributionAuthenticateClient(conn); err != nil { conn.Close(); return nil, err }\n', 1),
    ])
    edit('main.go', [
        ('func main() {\n', 'func main() {\n\tif err := ios.ContributionRequirePrivateTransport(); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(3) }\n', 1),
        ('ticker := time.NewTicker(1 * time.Second)', 'ticker := time.NewTimer(1 * time.Second) // Contribution: exactly one explicit connection attempt, no reconnect loop', 1),
    ])
    edit('cmd_tunnel.go', [
        ('\t\terr := tunnel.CheckPermissions()\n\t\texitIfError("If --userspace is not set, we need sudo, an admin shell on Windows, or CAP_NET_ADMIN on Linux", err)', '\t\texitIfError("Contribution only permits the explicit userspace research route", fmt.Errorf("kernel tunnel disabled"))\n\t\treturn true', 1),
        ('\t\tpairRecordsPath, _ := ctx.Args.String("--pair-record-path")\n', '\t\tpairRecordsPath, _ := ctx.Args.String("--pair-record-path")\n\t\tif pairRecordsPath != os.Getenv("CONTRIBUTION_BACKEND_STATE") + "/pairings" { exitIfError("Contribution requires its private pairing directory", fmt.Errorf("pair-record path refused")); return true }\n', 1),
    ])
    for name in ['contribution_private.go', 'contribution_private_test.go']:
        original = ROOT / 'backends/go-ios/transport' / name
        shutil.copyfile(original, source / 'ios' / name)
        changes['ios/' + name] = {'before': None, 'after': hashlib.sha256(original.read_bytes()).hexdigest()}
    return changes


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 2:
        raise SystemExit('Pass one disposable copied module source directory; never the module cache.')
    print(json.dumps(apply(sys.argv[1]), indent=2))
