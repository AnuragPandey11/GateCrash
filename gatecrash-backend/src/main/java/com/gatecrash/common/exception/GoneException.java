package com.gatecrash.common.exception;

import org.springframework.http.HttpStatus;

/** The resource existed but its validity window has closed -- an expired pass, most notably. */
public class GoneException extends ApiException {

    public GoneException(String message) {
        super(HttpStatus.GONE, "GONE", message);
    }

    public GoneException(String code, String message) {
        super(HttpStatus.GONE, code, message);
    }
}
