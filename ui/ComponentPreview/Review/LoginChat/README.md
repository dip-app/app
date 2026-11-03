# Login action and grouped chat

Fresh native iPhone 17 Pro simulator captures at 402 × 874 points, November 3, 2026.

- [Login](login-welcome.png): shared bottom navigation action, no top DIP pill, guidance above.
- [Large text](login-large-text.png)
- [Maximum text size](login-largest-text.png): complete CTA remains readable; body scrolls.
- [Grouped chat](event-chat-grouped.png): six messages in three groups.

Login uses the existing DIPFloatingNavigation action state: 80-point height, 20-point horizontal insets and 21-point bottom inset. Signed-out mode does not instantiate tab controls. Connecting disables the action and keeps its surface opaque. Chat groups adjacent same-author-ID messages within five minutes on the same local calendar day; a different author, longer gap, day boundary or reversed timestamp starts a group. Author appears first; avatar/time appear last. Every message retains author/time accessibility metadata without repeating the visible labels.

Run the isolated host with `--onboarding=welcome`; add `--large-text` or `--largest-text` for accessibility review. Chat: `--screen=event-joined --chat-grouping-fixtures`, then Activity Chat.

Verification: all58 Swift package tests, full SDK app build, repository checks, the six onboarding scenarios, grouped-message/retry regressions and two motion/opaque-press scenarios pass across the recorded runs. The initial wider conversation run's grouping/history/keyboard/comment checks passed; final targeted reruns resolve its login-tab and accessibility-query failures. These are local/frontend checks, not live chat delivery or physical-device/VoiceOver evidence. [Independent review](../../../../docs/design/reviews/login-chat-2026-11-03.md).
