package social.thelegendsonline.native_app.data.model

import kotlinx.serialization.Serializable

/**
 * Hand-written DTOs are reserved for endpoints that are NOT in the
 * shared OpenAPI spec (`lib/api-spec/openapi.yaml`). All other models
 * (User, Message, ConversationSummary, LoginBody, RegisterBody,
 * AuthResponse, SendMessageBody, …) come from the openapi-generator
 * Gradle plugin — see `app/build.gradle.kts` and consume them under
 * `social.thelegendsonline.native_app.data.openapi.model.*`.
 */

@Serializable
// `/api/push/fcm-register` is intentionally outside the public OpenAPI
// surface (push tokens are device-internal plumbing). Server validator
// (`routes/push.ts`) only accepts "ios" | "android" | "web" and silently
// coerces anything else to "android".
data class FcmRegisterRequest(val token: String, val platform: String = "android")
