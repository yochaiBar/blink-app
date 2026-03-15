# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Blink project. ADRs document significant technical decisions, their context, and their consequences.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-no-firebase.md) | Remove Firebase entirely in favor of self-managed services | Accepted |
| [002](002-expo-push-notifications.md) | Use Expo Push Notifications instead of direct FCM/APNs | Accepted |
| [003](003-server-side-otp.md) | Server-side OTP authentication via Twilio SMS | Accepted |
| [004](004-s3-presigned-uploads.md) | Client-side S3 uploads via presigned URLs | Accepted |
| [005](005-zustand-over-redux.md) | Zustand for client state management over Redux | Accepted |
| [006](006-postgresql-otp-storage.md) | Move OTP storage from in-memory Map to PostgreSQL | Accepted |

## Format

Each ADR follows this structure:

- **Status** -- Accepted, Superseded, or Deprecated
- **Date** -- When the decision was made
- **Context** -- What problem we were solving and what options we considered
- **Decision** -- What we chose and why
- **Consequences** -- Trade-offs, both positive and negative
