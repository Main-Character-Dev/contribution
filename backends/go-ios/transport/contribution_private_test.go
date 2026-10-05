package ios

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func privateFixture(t *testing.T) []byte {
	t.Helper()
	directory, err := os.MkdirTemp("/tmp", "ct-backend-")
	if err != nil {
		t.Fatal(err)
	}
	directory, err = filepath.EvalSymlinks(directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(directory) })
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CONTRIBUTION_BACKEND_STATE", directory)
	key := make([]byte, 32)
	rand.Read(key)
	if err := os.WriteFile(filepath.Join(directory, "session.key"), key, 0600); err != nil {
		t.Fatal(err)
	}
	return key
}
func TestContributionPrivateKeyRejectsUnsafeState(t *testing.T) {
	key := privateFixture(t)
	observed, err := ContributionSessionSecret()
	if err != nil || !bytes.Equal(key, observed) {
		t.Fatal(err)
	}
	path := filepath.Join(os.Getenv("CONTRIBUTION_BACKEND_STATE"), "session.key")
	os.Chmod(path, 0644)
	if _, err := ContributionSessionSecret(); err == nil {
		t.Fatal("public key accepted")
	}
	os.Chmod(path, 0600)
	target := path + "-retained"
	os.Rename(path, target)
	os.Symlink(target, path)
	if _, err := ContributionSessionSecret(); err == nil {
		t.Fatal("linked key accepted")
	}
}
func TestContributionMutualAuthenticationAndRejectedClient(t *testing.T) {
	key := privateFixture(t)
	listener, err := ContributionPrivateListener(0)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		_, err = conn.Write([]byte("owned"))
		done <- err
	}()
	wrong, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if err := contributionAuthenticateClient(wrong, bytes.Repeat([]byte{9}, 32)); err == nil {
		t.Fatal("wrong client authenticated")
	}
	wrong.Close()
	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := contributionAuthenticateClient(client, key); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(client)
	if err != nil || string(data) != "owned" {
		t.Fatalf("%q %v", data, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestContributionServerImpersonationFails(t *testing.T) {
	key := privateFixture(t)
	client, server := net.Pipe()
	defer client.Close()
	go func() {
		defer server.Close()
		server.Write(make([]byte, 32))
		io.ReadFull(server, make([]byte, 64))
		server.Write(make([]byte, 32))
	}()
	if err := contributionAuthenticateClient(client, key); err == nil {
		t.Fatal("false server authenticated")
	}
}
func TestContributionControlUsesOwnedUnixSocketAndPreservesUnknownSocket(t *testing.T) {
	privateFixture(t)
	listener, err := contributionControlListener()
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("scoped")) })}
	defer server.Close()
	go server.Serve(listener)
	transport := ContributionControlTransport()
	defer transport.(*http.Transport).CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	response, err := client.Get("http://unresolvable.invalid/private")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || string(body) != "scoped" {
		t.Fatal(err)
	}
	if _, err := contributionControlListener(); err == nil {
		t.Fatal("unknown retained socket replaced")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestContributionResearchCommandsNeverPermitBroadOrPrivilegedFallback(t *testing.T) {
	privateFixture(t)
	pairings := filepath.Join(os.Getenv("CONTRIBUTION_BACKEND_STATE"), "pairings")
	if err := os.Mkdir(pairings, 0700); err != nil {
		t.Fatal(err)
	}
	valid := [][]string{{"tunnel", "ls"}, {"tunnel", "stopagent"}, {"tunnel", "stop", "--udid", "fixture-device"}, {"tunnel", "start", "--userspace", "--udid", "fixture-device", "--pair-record-path", pairings}}
	for _, args := range valid {
		if err := contributionRequireCommand(args); err != nil {
			t.Fatal(args, err)
		}
	}
	invalid := [][]string{{"erase"}, {"install", "app.ipa"}, {"tunnel", "start"}, {"tunnel", "refresh", "--udid", "fixture-device"}, {"tunnel", "start", "--userspace", "--udid", "fixture-device", "--pair-record-path", "default"}, {"tunnel", "start", "--userspace", "--udid", "fixture-device", "--pair-record-path", pairings, "--tunnel-info-host", "0.0.0.0"}}
	for _, args := range invalid {
		if err := contributionRequireCommand(args); err == nil {
			t.Fatal("unsafe command accepted", args)
		}
	}
}
