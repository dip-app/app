# Work session

User: sandervonk
Date: 2026-11-18
Workstream: admin-storage-bucket
Agent: Claude
Status: completed

## Summary

Fixed 'The photo couldn't be loaded' in the admin portal: the live Firebase config had no storageBucket, so getStorage() threw for every Storage read.

## Changes

apps/admin/src/lib/firebaseAdapter.ts readLiveConfig now sets storageBucket (env NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET or <project>.firebasestorage.app); liveConfig test added.

## Validation

vitest liveConfig test and tsc; the bucket exists and the submission object is present (checked with gcloud).

## Decisions

Default the bucket from the project id so builds without the env var still work.

## Handoff

Deploy hosting; verify challenge evidence and album photos load.

