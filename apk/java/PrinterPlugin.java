package com.aavetements.atelierstock;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Impression Android (étiquettes, bordereaux) : la WebView n'a pas window.print(). */
@CapacitorPlugin(name = "Printer")
public class PrinterPlugin extends Plugin {
    private WebView printView; // gardée en mémoire pendant l'impression

    @PluginMethod
    public void print(PluginCall call) {
        final String name = call.getString("name", "Atelier Stock");
        getActivity().runOnUiThread(() -> {
            doPrint(getBridge().getWebView(), name);
            call.resolve();
        });
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html", "");
        final String base = call.getString("base", null);
        getActivity().runOnUiThread(() -> {
            WebView w = new WebView(getActivity());
            w.getSettings().setJavaScriptEnabled(true);
            w.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    view.postDelayed(() -> doPrint(view, "Etiquettes"), 300);
                }
            });
            printView = w;
            w.loadDataWithBaseURL(base, html, "text/html", "UTF-8", null);
            call.resolve();
        });
    }

    private void doPrint(WebView w, String name) {
        PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
        String job = name.replaceAll("[^A-Za-z0-9 _-]", "_");
        pm.print(job, w.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
    }
}
