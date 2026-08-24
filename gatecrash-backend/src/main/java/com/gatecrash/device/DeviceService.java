package com.gatecrash.device;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.device.dto.DeviceDtos.DeviceResponse;
import com.gatecrash.device.dto.DeviceDtos.RegisterDeviceRequest;
import com.gatecrash.security.SecurityUtils;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Device (FCM token) registration.
 *
 * <p>Tokens are owned by whoever last registered them. When a token that already exists is presented
 * by a different user -- which happens whenever two people share a handset, or one signs out and
 * another signs in -- ownership is <em>moved</em>, not duplicated. Leaving the old row in place would
 * keep delivering one resident's visitor alerts to a phone that now belongs to someone else.
 */
@Service
@RequiredArgsConstructor
public class DeviceService {

    private static final Logger log = LoggerFactory.getLogger(DeviceService.class);

    /** Bounds how many registrations one account can accumulate; stale ones are replaced, not stacked. */
    private static final int MAX_DEVICES_PER_USER = 10;

    private final DeviceRepository devices;
    private final AuditService audit;

    @Transactional
    public DeviceResponse register(RegisterDeviceRequest request) {
        UUID userId = SecurityUtils.currentUserId();
        String token = request.fcmToken().trim();

        Device device = devices.findByFcmToken(token).orElseGet(Device::new);
        boolean isNew = device.getId() == null;

        if (isNew && devices.countByUserId(userId) >= MAX_DEVICES_PER_USER) {
            throw new BusinessValidationException("TOO_MANY_DEVICES",
                    "This account has reached the maximum number of registered devices.");
        }
        if (!isNew && !userId.equals(device.getUserId())) {
            log.info("Reassigning FCM token from user {} to {}", device.getUserId(), userId);
        }

        device.setUserId(userId);
        device.setFcmToken(token);
        device.setPlatform(request.platform());
        device.setLastSeenAt(OffsetDateTime.now());
        devices.save(device);

        if (isNew) {
            audit.record(AuditAction.DEVICE_REGISTERED, "device", device.getId(),
                    AuditService.detail("platform", request.platform()));
        }
        return toResponse(device);
    }

    @Transactional(readOnly = true)
    public List<DeviceResponse> listMine() {
        return devices.findByUserId(SecurityUtils.currentUserId()).stream()
                .map(this::toResponse)
                .toList();
    }

    /**
     * De-registers on logout. A caller may only remove their own device; a 404 rather than a 403 for
     * someone else's, so the endpoint cannot be used to probe which device ids exist.
     */
    @Transactional
    public void deregister(UUID deviceId) {
        UUID userId = SecurityUtils.currentUserId();
        Device device = devices.findById(deviceId)
                .filter(candidate -> candidate.getUserId().equals(userId))
                .orElseThrow(() -> NotFoundException.of("Device", deviceId));

        devices.delete(device);
        audit.record(AuditAction.DEVICE_REMOVED, "device", deviceId, null);
    }

    @Transactional(readOnly = true)
    public List<String> tokensFor(UUID userId) {
        return devices.findTokensByUserId(userId);
    }

    @Transactional(readOnly = true)
    public List<String> tokensFor(Collection<UUID> userIds) {
        return userIds.isEmpty() ? List.of() : devices.findTokensByUserIds(userIds);
    }

    /** Removes registrations FCM has reported as permanently invalid. */
    @Transactional
    public void pruneTokens(Collection<String> tokens) {
        if (tokens == null || tokens.isEmpty()) {
            return;
        }
        int removed = devices.deleteByTokens(tokens);
        if (removed > 0) {
            log.info("Pruned {} stale FCM token(s)", removed);
        }
    }

    private DeviceResponse toResponse(Device device) {
        return new DeviceResponse(device.getId(), device.getPlatform(), device.getLastSeenAt(),
                device.getCreatedAt());
    }
}
