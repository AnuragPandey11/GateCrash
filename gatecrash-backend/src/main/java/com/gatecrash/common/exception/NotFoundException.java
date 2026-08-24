package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/** The addressed resource does not exist, or the caller is not allowed to learn that it does. */
public class NotFoundException extends ApiException {

    public NotFoundException(String message) {
        super(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
    }

    public static NotFoundException of(String entity, Object id) {
        return new NotFoundException(entity + " not found: " + id);
    }
}
