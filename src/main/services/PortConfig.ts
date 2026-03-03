/**
 * Centralized port configuration for all services.
 * R2-M9: Single source of truth for all network ports.
 */

export const SIDECAR_HOST = '127.0.0.1';
export const SIDECAR_PORT = 8520;
export const SIDECAR_BASE_URL = `http://${SIDECAR_HOST}:${SIDECAR_PORT}`;

export const GO2RTC_API_PORT = 1984;
export const GO2RTC_RTSP_PORT = 8554;
export const GO2RTC_HOST = '127.0.0.1';
export const GO2RTC_API_URL = `http://${GO2RTC_HOST}:${GO2RTC_API_PORT}`;
