# V2 accessibility sweep (F6) and contrast list

Last updated November 11, 2026. This records what the polish pass changed or checked by reading code, and what still needs a VoiceOver or Dynamic Type run on a device. Nothing here replaces that run.

## Sweep status

| Area | Done in code | Still to verify on a device |
| --- | --- | --- |
| Bottom action bar (Join, Activity Chat, Add Photos, entry) | Label scales with Dynamic Type (`relativeTo`), wraps to two lines and then shrinks (down to 0.4) instead of truncating; the 80 pt capsule is never smaller than the 44 pt target | AX5 on the event page with a long action title |
| Pills (Goal, Reward, Directions, Share, changes) | Outline and solid pills wrap up to four lines at larger sizes instead of truncating (`DIPActionPill`) | Weekly theme with a very long goal at AX3+ |
| Event page | Where row is one combined element ("venue, address, locality") with a "Get directions" hint; a missing venue reads "Location to be announced"; the unavailable page states its reason | Reading order with the changes sheet |
| Join / Leave | The result is announced ("You joined Kayaking", "You left Kayaking") and a refused or failed change is announced with its message | Announcement timing against the haptic |
| Album | Finished upload runs are announced ("3 photos added", "1 photo couldn't be added. Retry is available."); upload tiles keep their per-state labels; the viewer has Previous/Next photo buttons (44 pt, labelled), a spoken "Photo 3 of 12" position, and Next/Previous photo accessibility actions on the image | Viewer rotor order, comment pills at AX sizes |
| Photo comments | Send failures say whether the device is offline or give the server's own message; the draft is kept | Keyboard avoidance at AX sizes |
| Weekly theme page | Goal and Reward pills read "Goal: 3 workouts" / "Reward: +50 points"; info card rows keep the event page's icon column and 14 pt body text | Entry sheet focus order |
| Home, My Events, Profile, Invitations | Earlier first pass (card labels with date and place, tab selected trait, notices as alerts) is unchanged | Full VoiceOver walk on a device |

Not changed by design: tinted info cards stay, white text on purple fills stays (owner decisions).

## Contrast list

WCAG 2.2 ratios computed from `ui/DesignSystem/tokens.json` primitives. AA needs 4.5:1 for text under 24 pt regular (or 18.66 pt bold) and 3:1 for large text and for UI component boundaries.

| Pair | Ratio | Where | Result |
| --- | --- | --- | --- |
| White on ink `#1E212B` | 16.06 | Tab bar, dark action capsule, quiet pills | Pass |
| Ink on white | 16.06 | Body text | Pass |
| Ink on yellow `#FFCC3E` | 10.67 | Reward accents | Pass |
| Ink on gray `#ECECEC` | 13.59 | Muted surfaces | Pass |
| White on purple `#7B88FA` | 3.11 | Accent action capsule (20 to 24 pt), solid pills (14 pt) | Pass for 24 pt button text and component edges; below 4.5 for 14 pt pill text. Locked: white on purple stays. A darker purple would pass and is the one-token fix if the owner reopens it |
| Purple on white | 3.11 | Outline pill text and icon (14 pt), Rewards links | Same as above; the outline border itself passes 3:1 |
| Purple on the 7% purple info card | 2.91 | Info card icons and the Where/When trailing glyphs | Icons only (decorative, hidden from VoiceOver); body text on the card is ink |
| White on pink `#F054A5` | 3.22 | Notification and events accents | Large text only |
| White on orange `#FD4D03` | 3.37 | Reward badge | Large or bold text only |
| White on complete gray `#CCCCCC` | 1.61 | Disabled "complete" bar states ("Activity full", "Photo limit reached" use the muted capsule) | Fails 4.5, but these controls are disabled, which WCAG exempts. The label is still spoken. Prefer ink on gray (10.0) if the owner wants it readable |

## Dynamic Type rules used

- Primary actions wrap or scale, never truncate; targets stay at least 44 pt.
- Information (cards, rows, pills) wraps; fixed-height containers are only used for chrome.
- Motion respects Reduce Motion (tab marker, upload strip, transitions).

## Storage lifecycle note (event photos)

Event photos live under `companies/{companyId}/events/{eventId}/photos/{uploaderId}/{slot}` in Cloud Storage (create-only, see `gcp/storage.rules`). There is no deletion path in V2: a member cannot delete a photo, and removing an event does not remove its photos. Before production at scale, add a lifecycle rule that deletes objects under cancelled or removed events after a retention period agreed with the owner, and an organizer deletion command. Nothing was changed in Storage rules or production by this pass.
