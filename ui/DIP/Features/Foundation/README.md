# UI foundation fixtures and integration handoff

The standalone host in `ui/ComponentPreview` defaults to the native SwiftUI Home fixture. Home uses the original design's typography, bundled assets, mock text/counts, image-overlay cards and custom four-icon navigation. Its goal is fidelity to Figma Home `35:147`; same-viewport evidence is in the review notes. This does not implement live accounts, events, challenges, rewards or RSVP behavior.

`DIPFoundationGallery` remains an optional development destination through `--gallery`. Its state consists of a selected tab, callback message/count and loading toggle. Its earlier adapted components are useful for state/API review but do not define Home's visual acceptance target. DIP startup also presents the Home fixture; live account/repository composition remains separate integration work.

Consumers map DTOs/domain state into presentation values. The feature owns formatting, image authorization/loading, async commands and navigation. Shared views receive presentation inputs and callbacks; no Firestore snapshot, callable client or raw backend error belongs in them. Home's bundled prototype media is fixture content with the source/license limits described in [asset provenance](../../../../docs/design/asset-provenance.md).

See [component contracts](../../../../docs/design/components.md), [preview host](../../../ComponentPreview/README.md) and [Home review notes](../../../ComponentPreview/Review/README.md) for the current target and evidence. Gallery tests do not establish Home fidelity. Record new checks and remaining differences before handing the presentation APIs to feature consumers.
