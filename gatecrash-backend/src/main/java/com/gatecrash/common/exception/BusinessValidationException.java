package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/**
 * The payload passed bean validation but violates a domain rule -- a meet-sales-agent visit with no
 * sales agent, a pass window longer than policy allows. Rendered as 422 to distinguish "syntactically
 * wrong" (400) from "semantically impossible" (422).
 *
 * <p>Named to avoid colliding with {@code jakarta.validation.ValidationException}; BACKEND.md
 * section 11 calls this {@code ValidationException}.
 */
public class BusinessValidationException extends ApiException {

    public BusinessValidationException(String message) {
        super(HttpStatus.UNPROCESSABLE_ENTITY, "UNPROCESSABLE", message);
    }

    public BusinessValidationException(String code, String message) {
        super(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
    }
}
