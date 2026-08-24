package com.gatecrash.device;

import com.gatecrash.device.dto.DeviceDtos.DeviceResponse;
import com.gatecrash.device.dto.DeviceDtos.RegisterDeviceRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/devices")
@RequiredArgsConstructor
@Tag(name = "Devices")
public class DeviceController {

    private final DeviceService devices;

    @PostMapping
    @Operation(summary = "Register or refresh this device's FCM token")
    public DeviceResponse register(@Valid @RequestBody RegisterDeviceRequest request) {
        return devices.register(request);
    }

    @GetMapping
    @Operation(summary = "List this account's registered devices")
    public List<DeviceResponse> listMine() {
        return devices.listMine();
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "De-register a device on logout")
    public void deregister(@PathVariable UUID id) {
        devices.deregister(id);
    }
}
