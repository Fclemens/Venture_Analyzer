// Supported upload types. Browser-safe (no Node imports).
//   kind "model" → sent to the model as a PDF/image attachment and transcribed
//   kind "local" → text is read on the server with a parser (exact, no model call)

export const FILE_TYPES = {
  pdf:  { mime: "application/pdf", kind: "model" },
  png:  { mime: "image/png", kind: "model" },
  jpg:  { mime: "image/jpeg", kind: "model" },
  jpeg: { mime: "image/jpeg", kind: "model" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "local" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "local" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "local" },
  csv:  { mime: "text/csv", kind: "local" },
  txt:  { mime: "text/plain", kind: "local" },
  md:   { mime: "text/markdown", kind: "local" },
};

export const ACCEPT_ATTR = Object.keys(FILE_TYPES).map(e => "." + e).join(",");
export const UPLOAD_PATTERN = new RegExp(`\\.(${Object.keys(FILE_TYPES).join("|")})$`, "i");

export const extOf = (name) => String(name || "").split(".").pop().toLowerCase();
export const typeOf = (name) => FILE_TYPES[extOf(name)] || null;
