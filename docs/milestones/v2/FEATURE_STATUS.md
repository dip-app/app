# Interactive feature status

This file distinguishes working local features from design-only or placeholder UI. A mock-backed feature is not a deployed Firebase workflow.

| Feature | Frontend status | Backend status | Verification gate |
| --- | --- | --- | --- |
| Activity chat | **Implemented — mock-backed frontend** | Not implemented | Open from joined activity, render authors/messages, send, close/reopen retaining observed messages, reject blank, retain failed draft and retry safely |
| Photo comments | **Implemented — mock-backed frontend** | Not implemented | Open photo, show original overlay/composer, add comment, close/reopen retaining observed thread, isolate threads by event/photo, retain failed draft and retry safely |

Frontend flags were removed after the seven-test connected-flow regression passed on October29 (including both explicit failure/retry/reopen tests), a full app build, and15 domain/presentation tests. Keep backend status explicit until authorized production adapters/rules are implemented and tested. Add evidence to the active session and preview review notes. Exact Figma reference exists for photo overlay 76:1884 and keyboard state 76:2021; no supplied high-fidelity activity-chat screen is available, so its layout must be identified as a design-system composition.

The human corrected the photo UI after functional verification: compact avatar-leading comment pills slightly overlap the image edges, showing only a few words plus ellipsis. The prior below-image discussion panel is rejected. Keep photo frontend flagged until that visual correction and interaction regression pass.

November1 correction verified: newest4 compact avatar-leading pills slightly overlap photo edges, show only a few words with ellipsis, and tap to center/expand with full-text scrolling after about4 lines. Outside tap collapses. The rejected thread panel is removed. Three conversation tests passed, including geometry/count/overlap/expansion/scroll assertions.
