package com.gatecrash.common;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * The single error envelope every failed request returns. {@code correlationId} is echoed from the
 * request MDC so a support ticket can be tied to server logs without exposing any internals.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(
        OffsetDateTime timestamp,
        int status,
        String error,
        String code,
        String message,
        String path,
        String correlationId,
        List<FieldError> fieldErrors) {

    public record FieldError(String field, String message) {
    }

    public static ApiError of(int status, String error, String code, String message,
                              String path, String correlationId) {
        return new ApiError(OffsetDateTime.now(), status, error, code, message, path, correlationId, null);
    }

    public ApiError withFieldErrors(List<FieldError> errors) {
        return new ApiError(timestamp, status, error, code, message, path, correlationId,
                errors == null || errors.isEmpty() ? null : errors);
    }
}
