package com.gatecrash.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gatecrash.common.ApiError;
import com.gatecrash.common.CorrelationIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Replaces the servlet container's default 401, which would otherwise emit an HTML page and (for a
 * browser client) a {@code WWW-Authenticate: Basic} challenge that pops a native login dialog.
 */
@Component
@RequiredArgsConstructor
public class RestAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        ApiError body = ApiError.of(HttpStatus.UNAUTHORIZED.value(), HttpStatus.UNAUTHORIZED.getReasonPhrase(),
                "UNAUTHORIZED", "Authentication is required.", request.getRequestURI(),
                CorrelationIdFilter.current());
        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
