# Feature-owned backend modules

The V1 work packets own accounts/, participation/ and organizer/; the weekly-theme work owns challenges/. Each module may contain transport/, application/, domain/ and infrastructure/ internally. Keep unrelated feature edits in separate modules. Export callable handlers from that module's index.ts; the integrator alone wires gcp/functions/src/index.ts after contract/rules review.

Top-level transport/application/domain/infrastructure folders are reserved for reviewed cross-cutting helpers, not a shared dumping ground for every feature. Prefer module-local code until a real shared need exists. No module implements a product command on setup.
