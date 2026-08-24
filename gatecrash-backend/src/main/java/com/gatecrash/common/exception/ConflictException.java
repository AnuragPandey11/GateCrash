package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/**
 * The request is well-formed but conflicts with current state: an illegal FSM transition, a reused
 * pass, a duplicate {@code login_id}. Always paired with a DB constraint that is the real backstop.
 */
public class ConflictException extends ApiException {

    public ConflictException(String message) {
        super(HttpStatus.CONFLICT, "CONFLICT", message);
    }

    public ConflictException(String code, String message) {
        super(HttpStatus.CONFLICT, code, message);
    }

    public static ConflictException illegalTransition(String entity, Object from, Object to) {
        return new ConflictException("ILLEGAL_TRANSITION",
                entity + " cannot move from " + from + " to " + to);
    }
}
