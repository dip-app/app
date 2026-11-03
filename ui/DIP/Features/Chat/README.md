# Activity chat

DIPActivityChatScreen is a native composition of DIPMessageComposer, DIPConversationBubble, shared fonts/colors and media rendering. No exact high-fidelity chat frame was supplied; this screen is not a pixel-perfect claim against another page's reference.

Inputs are eventTitle, observed DIPMessage values, currentUserID and an asynchronous throwing onSend(messageID:text:) callback. The view owns only composer text, focus, pending/error state and a retained send intent. It never appends messages locally. New observed messages scroll into view; the composer respects the keyboard and allows multiple lines without automatically opening the keyboard on presentation.

Blank, over-2,000-character and in-flight submissions are disabled. A failed submission retains its draft and retry identity. Retrying unchanged text reuses the message ID so the repository can make delivery idempotent; editing creates a new send intent. A successful command acknowledgement clears the draft; repository observation supplies the message bubble. Errors remain visible and retryable.

The composition root supplies DIPAppViewModel.sendMessage(eventID:messageID:text:). DIPRepository owns author identity, attribution, timestamps and persistence policy. DIPMockRepository implements process-lifetime behavior; a future Firebase adapter must enforce participation, authorization, validation and idempotency under the reviewed V2 contract. See [repository boundary](../../../../docs/contracts/ui-repositories.md). No Firebase call, authentication check or cloud persistence is performed by the view.

Stable identifiers include event.chat.message, event.chat.send, event.chat.error, event.chat.retry, event.chat.empty and event.chat.message.<messageID>. Done dismisses the sheet. Package and simulator evidence belongs in the session/review notes; rendering this screen alone does not establish backend readiness.
