# Login action and chat grouping review — November 3, 2026

User direction: use the existing bottom navigation action on login, remove the top DIP pill, move work-account guidance, and group consecutive messages instead of repeating person/time metadata. [Captures](../../../ui/ComponentPreview/Review/LoginChat/README.md).

Independent rubric result: **9.2/10**. App consistency9.4, accessibility9.1, grouping logic9.5. Normal and AX5 login captures show a complete shared action label, readable guidance, and scrollable content. Grouped capture shows six messages in three correctly aligned groups. This assesses consistency with the app and the user's explicit direction; it is not a new Figma pixel comparison.

Findings addressed:

- Signed-out tab controls were still mounted behind the action; showsTabs:false now removes them structurally.
- Fixed80-point bar could clip large labels; two-line fitting/scaling is verified at the largest text size.
- Visual metadata must not be spoken twice; author/time are provided once through each message's accessibility value while their decorative visual labels are hidden from accessibility.
- A retry assertion counted text wrappers rather than observed message rows. It now proves one message row after retry/reopen; repository tests separately enforce command-id idempotency. Final retry and grouping UI rerun passed with a valid result bundle (14:50:51), clearing the review's test-evidence condition.

Grouping tests cover sender identity rather than matching names, adjacency, five-minute boundary, local day change, reversed timestamps and empty input. No auth, wire-schema or backend delivery policy changed. Physical-device and VoiceOver checks remain separate manual evidence.
