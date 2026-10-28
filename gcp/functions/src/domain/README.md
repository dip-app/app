# Domain rules

Place deterministic business rules and value objects here. Keep this layer independent of Firebase SDKs, network calls, and wall-clock globals. Pass the current time as an input when a rule needs it. Unit tests should cover boundaries and rejected actions, not mirror implementation details.
