export interface UploadState {
  status: "idle" | "error";
  message: string | null;
}

export const IDLE_UPLOAD_STATE: UploadState = { status: "idle", message: null };
