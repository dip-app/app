# Transport adapters

Place Firebase v2 `onCall` handlers here. Validate requests against the shared contract, require authenticated callers, derive the caller UID from auth, translate use-case failures to documented `HttpsError` codes, and delegate to application services. Keep authorization checks and App Check policy explicit. Do not put Firestore transaction logic in this layer.
