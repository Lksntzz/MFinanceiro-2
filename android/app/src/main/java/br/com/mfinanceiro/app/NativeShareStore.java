package br.com.mfinanceiro.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.UUID;

final class NativeShareStore {
    private static final String PREFS_NAME = "mf_native_share";
    private static final String PAYLOAD_KEY = "pending_payload";
    private static final String CACHE_DIRECTORY = "mf-native-share";
    private static final long MAX_FILE_BYTES = 20L * 1024L * 1024L;

    private NativeShareStore() {}

    static boolean capture(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;

        String title = truncate(intent.getStringExtra(Intent.EXTRA_SUBJECT), 500);
        String text = truncate(intent.getStringExtra(Intent.EXTRA_TEXT), 10_000);
        Uri stream = sharedStream(intent);
        if (stream == null && isBlank(text)) return false;

        clear(context);

        try {
            JSONObject payload = basePayload(title, text);
            if (stream != null) {
                SharedFile file = copySharedFile(context, stream, intent.getType());
                payload.put("fileUri", Uri.fromFile(file.file).toString());
                payload.put("fileName", file.name);
                payload.put("mimeType", file.mimeType);
                payload.put("size", file.size);
            }
            persist(context, payload);
        } catch (Exception error) {
            try {
                JSONObject payload = basePayload(title, text);
                payload.put("error", userFacingError(error));
                persist(context, payload);
            } catch (JSONException ignored) {
                return false;
            }
        }

        return true;
    }

    static String read(Context context) {
        return preferences(context).getString(PAYLOAD_KEY, null);
    }

    static void clear(Context context) {
        String raw = read(context);
        if (raw != null) {
            try {
                JSONObject payload = new JSONObject(raw);
                String fileUri = payload.optString("fileUri", "");
                if (!fileUri.isEmpty()) deleteCachedFile(context, Uri.parse(fileUri));
            } catch (JSONException ignored) {
                // A malformed private preference should not block cleanup.
            }
        }
        preferences(context).edit().remove(PAYLOAD_KEY).apply();
        pruneCacheDirectory(context);
    }

    private static JSONObject basePayload(String title, String text) throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("id", UUID.randomUUID().toString());
        payload.put("createdAt", System.currentTimeMillis());
        payload.put("title", title == null ? "" : title);
        payload.put("text", text == null ? "" : text);
        return payload;
    }

    private static void persist(Context context, JSONObject payload) {
        preferences(context).edit().putString(PAYLOAD_KEY, payload.toString()).apply();
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @SuppressWarnings("deprecation")
    private static Uri sharedStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        Object value = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return value instanceof Uri ? (Uri) value : null;
    }

    private static SharedFile copySharedFile(Context context, Uri sourceUri, String declaredMimeType) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        SharedMetadata metadata = queryMetadata(resolver, sourceUri);
        String mimeType = normalizeMimeType(resolver.getType(sourceUri), declaredMimeType, metadata.name);
        if (!isSupportedMimeType(mimeType)) {
            throw new IOException("unsupported-type");
        }
        if (metadata.size > MAX_FILE_BYTES) {
            throw new IOException("file-too-large");
        }

        File directory = shareDirectory(context);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("cache-directory");
        }

        String safeName = safeFileName(metadata.name, mimeType);
        File target = new File(directory, UUID.randomUUID() + "-" + safeName);
        long copied = 0;

        try (InputStream input = resolver.openInputStream(sourceUri);
             FileOutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IOException("unreadable-source");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                copied += read;
                if (copied > MAX_FILE_BYTES) {
                    throw new IOException("file-too-large");
                }
                output.write(buffer, 0, read);
            }
            output.flush();
        } catch (IOException error) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw error;
        }

        if (copied < 1) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw new IOException("empty-file");
        }

        return new SharedFile(target, safeName, mimeType, copied);
    }

    private static SharedMetadata queryMetadata(ContentResolver resolver, Uri uri) {
        String name = "documento";
        long size = -1;
        String[] projection = { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        try (Cursor cursor = resolver.query(uri, projection, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex);
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex);
            }
        } catch (RuntimeException ignored) {
            // Some providers expose the stream but not metadata. Copying will determine the real size.
        }
        return new SharedMetadata(name, size);
    }

    private static String normalizeMimeType(String resolverType, String declaredType, String fileName) {
        String type = !isBlank(resolverType) ? resolverType : declaredType;
        if (!isBlank(type) && !"*/*".equals(type)) return type.toLowerCase(Locale.ROOT);

        String lower = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    private static boolean isSupportedMimeType(String mimeType) {
        return "application/pdf".equals(mimeType)
            || "image/jpeg".equals(mimeType)
            || "image/png".equals(mimeType)
            || "image/webp".equals(mimeType);
    }

    private static String safeFileName(String value, String mimeType) {
        String fallback = "application/pdf".equals(mimeType) ? "documento.pdf" : "documento-imagem";
        String source = isBlank(value) ? fallback : value;
        String safe = source
            .replaceAll("[^a-zA-Z0-9._-]+", "-")
            .replaceAll("-+", "-")
            .replaceAll("^-|-$", "");
        if (safe.isEmpty()) safe = fallback;
        if (safe.length() > 120) safe = safe.substring(safe.length() - 120);
        return safe;
    }

    private static String userFacingError(Exception error) {
        String code = error.getMessage() == null ? "" : error.getMessage();
        if ("file-too-large".equals(code)) {
            return "O arquivo compartilhado ultrapassa 20 MB. Escolha um PDF ou imagem menor para revisar no MF.";
        }
        if ("unsupported-type".equals(code)) {
            return "Este tipo de arquivo não é aceito pelo MF Scan. Compartilhe PDF, JPEG, PNG ou WebP.";
        }
        if ("empty-file".equals(code)) {
            return "O arquivo compartilhado está vazio e não pôde ser analisado.";
        }
        return "Não foi possível copiar o arquivo compartilhado. Tente compartilhar novamente ou escolha o arquivo pelo MF Scan.";
    }

    private static void deleteCachedFile(Context context, Uri uri) {
        if (!"file".equals(uri.getScheme()) || uri.getPath() == null) return;
        try {
            File directory = shareDirectory(context).getCanonicalFile();
            File file = new File(uri.getPath()).getCanonicalFile();
            String directoryPath = directory.getPath() + File.separator;
            if (file.getPath().startsWith(directoryPath)) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        } catch (IOException ignored) {
            // Best-effort cleanup only.
        }
    }

    private static void pruneCacheDirectory(Context context) {
        File directory = shareDirectory(context);
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private static File shareDirectory(Context context) {
        return new File(context.getCacheDir(), CACHE_DIRECTORY);
    }

    private static String truncate(String value, int maxLength) {
        if (value == null) return null;
        String clean = value.trim();
        return clean.length() <= maxLength ? clean : clean.substring(0, maxLength);
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static final class SharedMetadata {
        final String name;
        final long size;

        SharedMetadata(String name, long size) {
            this.name = name;
            this.size = size;
        }
    }

    private static final class SharedFile {
        final File file;
        final String name;
        final String mimeType;
        final long size;

        SharedFile(File file, String name, String mimeType, long size) {
            this.file = file;
            this.name = name;
            this.mimeType = mimeType;
            this.size = size;
        }
    }
}
