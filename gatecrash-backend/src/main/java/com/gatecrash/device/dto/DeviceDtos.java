package com.gatecrash.device.dto;

import com.gatecrash.device.DevicePlatform;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class DeviceDtos {

    private DeviceDtos() {
    }

    /** FCM registration tokens run to a few hundred characters; 4096 is generous headroom. */
    public record RegisterDeviceRequest(
            @NotBlank @Size(max = 4096) String fcmToken,
            @NotNull DevicePlatform platform) {
    }

    /** The token is never echoed back -- the client already has it, and logs should not. */
    public record DeviceResponse(UUID id, DevicePlatform platform, OffsetDateTime lastSeenAt,
                                 OffsetDateTime createdAt) {
    }
}
