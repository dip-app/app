# Setup dependency notes

Local/CI tooling uses Node24.12+ because Firebase13 and rules-unit-testing6 require it. Deployed Functions are explicitly Node22 in firebase.json; their source package supports Node22..24 and CI checks the backend independently on Node22. Do not change the cloud runtime just to satisfy a local test-tool engine.

The lockfile uses current compatible Firebase Functions7/Admin14 packages. An explicit same-major @grpc/grpc-js override to >=1.14.6 removes the inherited high-severity gRPC advisories. Real Firestore/Storage emulator tests pass with the override. Keep it until upstream dependency ranges adopt the patched release.

The setup audit still reports five moderate advisories propagated through Firebase CLI development tooling (uuid/gaxios and OpenTelemetry/PubSub). Forced audit fixes propose incompatible downgrades or major dependency substitutions, so none were applied blindly. Reassess when upgrading Firebase CLI; these tools do not ship in deployed Functions. Do not mistake a clean application build for a clean dependency audit. No high/critical advisory remains in the setup lockfile at validation time.

The app's Firebase Apple SDK is declared in XcodeGen but not resolved/locked until the first application integration build; Swift package tests here cover the dependency-free contracts/token foundations. Minimum OS, final bundle ID, signing team, cloud environments and region still require the documented team decisions.

Validation also ran `npm audit --omit=dev --workspace @dip/functions --include-workspace-root=false`: zero reported production dependency advisories.
