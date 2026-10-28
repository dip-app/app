# Setup constraints and pending decisions

These are explicit handoffs rather than guessed credentials, owners or product policy. Fixture-based development can start now.

| Item | Current evidence/status | Who decides | Needed before |
| --- | --- | --- | --- |
| Main integration branch | main exists, is default, and baseline CI is green | Already established by repository owner | New feature branches |
| Required status enforcement | On October 28 the branch-protection API returned HTTP403: current plan does not enable the feature for this private repository. CI jobs and session rejection logic exist; merge prevention is not enforced. | Organization/repository administrator selects an eligible plan/policy; never change visibility or billing automatically | Treating required checks as unbypassable |
| Real reviewers / CODEOWNERS | Responsibility areas exist; actual usernames/teams are unassigned. CODEOWNERS.example is deliberately inactive. | Team assigns people, then integrator configures actual CODEOWNERS | Cross-part feature review |
| Cloud projects and location | No live project ID/credential configured; tests explicitly target demo-dip | Firebase/GCP owner | Live integration/deployment; not local tests |
| iOS signing / bundle identifier | Bootstrap uses proposed identifier/minimum OS; signing remains local | iOS/release owner | Device/release builds |
| Contract refinements | Typed V1 interfaces exist; ADRs 0001–0003 remain proposed | Backend and iOS reviewers | Approving dependent implementations |
| Font/image assets, contrast and modes | Observed Figma foundations recorded; assets/licensing and dark mode unresolved | Design and iOS owners | Adopting assets/themes/components |
| Product verification | No product workflows built on setup; coverage targets belong to implemented V1/V2 logic | Each packet owner plus integrator | Feature/release completion |

Branch-protection failure is a GitHub plan limitation, not an automatic approval rejection or missing repository admin permission. Keep the repository private. Maintainers should use reviewed PRs and green checks under the current plan; repository files alone cannot prevent bypass. When enforcement becomes available, require the existing five CI jobs on main, verify the job names on a real PR, and record the change in a session.
