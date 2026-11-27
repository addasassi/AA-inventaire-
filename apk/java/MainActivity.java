package com.aavetements.atelierstock;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrinterPlugin.class);
        registerPlugin(SaverPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15+ dessine l'app sous la barre d'état et la barre de navigation :
        // on décale la page pour qu'elle commence sous l'heure / la batterie et s'arrête
        // au-dessus des boutons du téléphone (et du clavier).
        final WebView wv = getBridge().getWebView();
        View parent = (View) wv.getParent();
        parent.setBackgroundColor(Color.parseColor("#3A2632"));
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#3A2632"));
        ViewCompat.setOnApplyWindowInsetsListener(wv, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime());
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            if (lp.topMargin != b.top || lp.bottomMargin != b.bottom || lp.leftMargin != b.left || lp.rightMargin != b.right) {
                lp.topMargin = b.top;
                lp.bottomMargin = b.bottom;
                lp.leftMargin = b.left;
                lp.rightMargin = b.right;
                v.setLayoutParams(lp);
            }
            return WindowInsetsCompat.CONSUMED;
        });
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(false);      // icônes blanches sur le fond prune
        c.setAppearanceLightNavigationBars(false);
        ViewCompat.requestApplyInsets(wv);
    }
}
