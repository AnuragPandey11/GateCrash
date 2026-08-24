package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/**
 * The caller is authenticated but not entitled to this object. Thrown by service-layer ownership
 * re-checks, which run in addition to {@code @PreAuthorize} role checks -- never instead of them.
 */
public class ForbiddenException extends ApiException {

    public ForbiddenException(String message) {
        super(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
    }

    public ForbiddenException(String code, String message) {
        super(HttpStatus.FORBIDDEN, code, message);
    }
}
