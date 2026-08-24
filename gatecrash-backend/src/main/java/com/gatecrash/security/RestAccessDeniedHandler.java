package com.gatecrash.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gatecrash.common.ApiError;
import com.gatecrash.common.CorrelationIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

/** Emits the standard {@link ApiError} envelope for authorization failures raised in the filter chain. */
@Component
@RequiredArgsConstructor
public class RestAccessDeniedHandler implements AccessDeniedHandler {

    private static final Logger log = LoggerFactory.getLogger(RestAccessDeniedHandler.class);

    private final ObjectMapper objectMapper;

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
                       AccessDeniedException ex) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        // Authorization failures are security-relevant: always leave a trace of who tried what.
        log.warn("Access denied for user {} on {} {}", SecurityUtils.currentUserIdOrNull(),
                request.getMethod(), request.getRequestURI());

        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        ApiError body = ApiError.of(HttpStatus.FORBIDDEN.value(), HttpStatus.FORBIDDEN.getReasonPhrase(),
                "FORBIDDEN", "You do not have permission to perform this action.",
                request.getRequestURI(), CorrelationIdFilter.current());
        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
