package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/**
 * Credentials are missing, wrong, or no longer valid.
 *
 * <p>Callers should always use the same message regardless of which of those it was -- a login form
 * that distinguishes "no such user" from "wrong password" is a user-enumeration oracle.
 */
public class UnauthorizedException extends ApiException {

    public UnauthorizedException(String message) {
        super(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
    }

    public UnauthorizedException(String code, String message) {
        super(HttpStatus.UNAUTHORIZED, code, message);
    }

    public static UnauthorizedException invalidCredentials() {
        return new UnauthorizedException("INVALID_CREDENTIALS", "Invalid login id or password.");
    }
}
