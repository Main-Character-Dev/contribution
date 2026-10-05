// Copyright 2026 Contribution contributors. MIT license.
// Standalone interoperability fixture. No upstream device package is linked.
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

func main() {
    if len(os.Args) != 2 || (os.Args[1] != "ready" && os.Args[1] != "not-ready" && os.Args[1] != "not-found") { os.Exit(2) }
    mode := os.Args[1]
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet { w.WriteHeader(http.StatusMethodNotAllowed); return }
        switch r.URL.Path {
        case "/health":
            w.WriteHeader(http.StatusOK)
        case "/ready":
            if mode == "not-ready" { w.WriteHeader(http.StatusServiceUnavailable) } else { w.WriteHeader(http.StatusOK) }
        case "/tunnel/fixture-phone-001":
            if mode == "not-found" { http.NotFound(w, r); return }
            w.Header().Set("Content-Type", "application/json")
            json.NewEncoder(w).Encode(map[string]any{"address": "fd12::1", "rsdPort": 58783, "udid": "fixture-phone-001", "userspaceTun": true, "userspaceTunPort": 54321})
        default:
            http.NotFound(w, r)
        }
    })
    if err := ContributionServeControl(handler); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(3) }
}
