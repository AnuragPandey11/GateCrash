package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/**
 * A throttle tripped: login brute-force lockout, or PIN-redemption rate limiting. The message is
 * deliberately vague about how much budget is left so it cannot be used to tune an attack.
 */
public class TooManyRequestsException extends ApiException {

    public TooManyRequestsException(String message) {
        super(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS", message);
    }
}
