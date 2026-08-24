package com.gatecrash.common;

import com.gatecrash.common.exception.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.List;

/**
 * Translates everything thrown below the controller layer into an {@link ApiError}.
 *
 * <p>Two rules drive the design:
 * <ul>
 *   <li>Known {@link ApiException}s carry their own status and are safe to echo verbatim.</li>
 *   <li>Anything else is an unexpected fault: it is logged in full server-side and returned to the
 *       client as an opaque 500 carrying only the correlation id. Stack traces, SQL fragments and
 *       constraint names never reach a client.</li>
 * </ul>
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApi(ApiException ex, HttpServletRequest request) {
        // Expected, client-visible outcome: logged at WARN without a stack trace to keep noise down.
        log.warn("{} {} -> {} ({}): {}", request.getMethod(), request.getRequestURI(),
                ex.getStatus().value(), ex.getCode(), ex.getMessage());
        return build(ex.getStatus(), ex.getCode(), ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException ex, HttpServletRequest request) {
        log.warn("Access denied: {} {}", request.getMethod(), request.getRequestURI());
        return build(HttpStatus.FORBIDDEN, "FORBIDDEN", "You do not have permission to perform this action.",
                request.getRequestURI());
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiError> handleAuthentication(AuthenticationException ex, HttpServletRequest request) {
        log.warn("Authentication failure on {} {}", request.getMethod(), request.getRequestURI());
        return build(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authentication is required.",
                request.getRequestURI());
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiError> handleConstraintViolation(ConstraintViolationException ex,
                                                              HttpServletRequest request) {
        List<ApiError.FieldError> fields = ex.getConstraintViolations().stream()
                .map(v -> new ApiError.FieldError(v.getPropertyPath().toString(), v.getMessage()))
                .toList();
        return ResponseEntity.badRequest().body(
                error(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Request validation failed.",
                        request.getRequestURI()).withFieldErrors(fields));
    }

    /**
     * A DB constraint fired that the service layer should have caught first. That is a real bug or a
     * lost race, so it is logged at ERROR -- but the constraint name is never echoed to the client.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleDataIntegrity(DataIntegrityViolationException ex,
                                                        HttpServletRequest request) {
        log.error("Data integrity violation on {} {}", request.getMethod(), request.getRequestURI(), ex);
        return build(HttpStatus.CONFLICT, "CONFLICT",
                "The request conflicts with the current state of the resource.", request.getRequestURI());
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiError> handleOptimisticLock(OptimisticLockingFailureException ex,
                                                          HttpServletRequest request) {
        log.warn("Optimistic lock failure on {} {}", request.getMethod(), request.getRequestURI());
        return build(HttpStatus.CONFLICT, "CONCURRENT_MODIFICATION",
                "The resource was modified concurrently. Reload and retry.", request.getRequestURI());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception on {} {}", request.getMethod(), request.getRequestURI(), ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "An unexpected error occurred. Quote the correlation id when reporting this.",
                request.getRequestURI());
    }

    // ----- Spring MVC's own exceptions, re-rendered into the same envelope -------------------

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
                                                                  HttpHeaders headers,
                                                                  HttpStatusCode status,
                                                                  WebRequest request) {
        List<ApiError.FieldError> fields = ex.getBindingResult().getFieldErrors().stream()
                .map(f -> new ApiError.FieldError(f.getField(), f.getDefaultMessage()))
                .toList();
        ApiError body = error(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Request validation failed.",
                path(request)).withFieldErrors(fields);
        return ResponseEntity.badRequest().body(body);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException ex,
                                                                  HttpHeaders headers,
                                                                  HttpStatusCode status,
                                                                  WebRequest request) {
        // The parser message can quote payload fragments; keep it server-side only.
        log.warn("Malformed request body on {}: {}", path(request), ex.getMostSpecificCause().getMessage());
        return ResponseEntity.badRequest().body(
                error(HttpStatus.BAD_REQUEST, "MALFORMED_BODY", "Request body is malformed or has unknown fields.",
                        path(request)));
    }

    @Override
    protected ResponseEntity<Object> handleMissingServletRequestParameter(MissingServletRequestParameterException ex,
                                                                          HttpHeaders headers,
                                                                          HttpStatusCode status,
                                                                          WebRequest request) {
        return ResponseEntity.badRequest().body(
                error(HttpStatus.BAD_REQUEST, "MISSING_PARAMETER",
                        "Required parameter is missing: " + ex.getParameterName(), path(request)));
    }

    @Override
    protected ResponseEntity<Object> handleHttpRequestMethodNotSupported(HttpRequestMethodNotSupportedException ex,
                                                                         HttpHeaders headers,
                                                                         HttpStatusCode status,
                                                                         WebRequest request) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(
                error(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED",
                        "HTTP method not supported for this endpoint.", path(request)));
    }

    @Override
    protected ResponseEntity<Object> handleHttpMediaTypeNotSupported(HttpMediaTypeNotSupportedException ex,
                                                                     HttpHeaders headers,
                                                                     HttpStatusCode status,
                                                                     WebRequest request) {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(
                error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE",
                        "Content type not supported.", path(request)));
    }

    @Override
    protected ResponseEntity<Object> handleNoHandlerFoundException(NoHandlerFoundException ex,
                                                                   HttpHeaders headers,
                                                                   HttpStatusCode status,
                                                                   WebRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                error(HttpStatus.NOT_FOUND, "NOT_FOUND", "No such endpoint.", path(request)));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiError> handleTypeMismatch(MethodArgumentTypeMismatchException ex,
                                                        HttpServletRequest request) {
        return ResponseEntity.badRequest().body(
                error(HttpStatus.BAD_REQUEST, "TYPE_MISMATCH",
                        "Invalid value for parameter: " + ex.getName(), request.getRequestURI()));
    }

    // ----- helpers ---------------------------------------------------------------------------

    private ResponseEntity<ApiError> build(HttpStatus status, String code, String message, String path) {
        return ResponseEntity.status(status).body(error(status, code, message, path));
    }

    private ApiError error(HttpStatus status, String code, String message, String path) {
        return ApiError.of(status.value(), status.getReasonPhrase(), code, message, path,
                CorrelationIdFilter.current());
    }

    private String path(WebRequest request) {
        String description = request.getDescription(false);
        return description.startsWith("uri=") ? description.substring(4) : description;
    }
}
