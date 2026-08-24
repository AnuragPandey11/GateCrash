package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/**
 * Base type for every exception the API deliberately surfaces to a client.
 *
 * <p>Carrying the status and a stable machine-readable {@code code} on the exception keeps the
 * {@code GlobalExceptionHandler} a pure translation layer: services express intent, the handler
 * serialises it. Anything that is <em>not</em> an {@code ApiException} is treated as an unexpected
 * fault and rendered as an opaque 500, so internals can never leak through an error body.
 */
public abstract class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    protected ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
