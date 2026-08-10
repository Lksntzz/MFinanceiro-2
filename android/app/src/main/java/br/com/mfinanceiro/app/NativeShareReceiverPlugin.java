package br.com.mfinanceiro.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeShareReceiver")
public class NativeShareReceiverPlugin extends Plugin {

    @PluginMethod()
    public void getPendingShare(PluginCall call) {
        String raw = NativeShareStore.read(getContext());
        JSObject result = new JSObject();
        if (raw == null || raw.trim().isEmpty()) {
            result.put("pending", false);
            call.resolve(result);
            return;
        }

        try {
            JSONObject payload = new JSONObject(raw);
            result.put("pending", true);
            result.put("id", payload.optString("id", ""));
            result.put("createdAt", payload.optLong("createdAt", 0));
            result.put("title", payload.optString("title", ""));
            result.put("text", payload.optString("text", ""));
            result.put("fileUri", payload.optString("fileUri", ""));
            result.put("fileName", payload.optString("fileName", ""));
            result.put("mimeType", payload.optString("mimeType", ""));
            result.put("size", payload.optLong("size", 0));
            result.put("error", payload.optString("error", ""));
            call.resolve(result);
        } catch (JSONException error) {
            NativeShareStore.clear(getContext());
            call.reject("O compartilhamento nativo salvo está inválido e foi descartado.", null, error);
        }
    }

    @PluginMethod()
    public void clearPendingShare(PluginCall call) {
        NativeShareStore.clear(getContext());
        call.resolve();
    }
}
