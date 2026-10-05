# Disposable iPhone qualification app

This temporary test app is an acceptance fixture, not a permanent phone client for Contribution. It has no network listener, product or robot controls, background session manager, or automatic data reset. It creates state only when the owner selects **Create fixture state**.

The fixture retains an installation marker, local records, an editable draft/configuration, simulated pending work and a Keychain continuity proof. The Keychain item uses this app's normal signing access group. A missing or changed key is visible and is never silently repaired on launch. Unknown/corrupt state is preserved. Sharing a snapshot is explicit and includes hashes rather than record/draft text or the Keychain value.

`bash scripts/build-ios-fixture.sh` builds an unsigned Simulator artifact without installing it. Physical use requires owner-approved bundle ID/team/provisioning on each host. Keep the bundle ID, signing team, Keychain group and migration schema identical between the two builds. Increment `CURRENT_PROJECT_VERSION` for the second build. Never use uninstall/reinstall, data reset, a different team or a downgrade as a substitute for in-place update qualification.

For AT-16 and the relevant install/launch cases: create and edit the fixture state; export the before snapshot privately; close the app; update in place through the qualified route; launch or reopen as separately authorized; compare every state digest, marker and Keychain proof; retain the observed new build and separate launch result. Build success alone does not establish physical persistence, signing, networking or installation.
