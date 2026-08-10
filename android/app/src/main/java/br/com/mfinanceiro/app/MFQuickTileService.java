package br.com.mfinanceiro.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import androidx.core.service.quicksettings.PendingIntentActivityWrapper;
import androidx.core.service.quicksettings.TileServiceCompat;

public class MFQuickTileService extends TileService {
    private static final int QUICK_REQUEST_CODE = 4101;

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;

        CharSequence label = getString(R.string.quick_settings_tile_label);
        tile.setLabel(label);
        tile.setContentDescription(getString(R.string.quick_settings_tile_description));
        tile.setState(Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(getString(R.string.quick_settings_tile_subtitle));
        }
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (isSecure() && isLocked()) {
            unlockAndRun(this::openQuickEntry);
            return;
        }
        openQuickEntry();
    }

    private void openQuickEntry() {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("mfinanceiro://quick"));
        intent.setPackage(getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntentActivityWrapper wrapper = new PendingIntentActivityWrapper(
            this,
            QUICK_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT,
            false
        );
        TileServiceCompat.startActivityAndCollapse(this, wrapper);
    }
}
