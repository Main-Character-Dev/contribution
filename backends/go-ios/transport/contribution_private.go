// Copyright 2026 Contribution contributors. MIT license.
// This file is overlaid into the checksum-verified upstream ios package.
package ios

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const contributionAuthTimeout = 3 * time.Second

// No fallback to an upstream public listener or shared Apple pairing directory.
func contributionState() (string, error) {
	path := os.Getenv("CONTRIBUTION_BACKEND_STATE")
	if !filepath.IsAbs(path) {
		return "", errors.New("private Contribution backend state is required")
	}
	real, err := filepath.EvalSymlinks(path)
	if err != nil || real != filepath.Clean(path) {
		return "", errors.New("backend state must be a canonical private directory")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return "", errors.New("backend state must be an owned 0700 directory")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) {
		return "", errors.New("backend state belongs to another user")
	}
	return path, nil
}

func ContributionSessionSecret() ([]byte, error) {
	directory, err := contributionState()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(directory, "session.key")
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Size() != 32 {
		return nil, errors.New("an exact private session key is required")
	}
	stat, ok := before.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) || stat.Nlink != 1 {
		return nil, errors.New("session key ownership is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return nil, errors.New("session key changed while opening")
	}
	key, err := io.ReadAll(io.LimitReader(file, 33))
	if err != nil || len(key) != 32 {
		return nil, errors.New("session key changed while reading")
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) || after.Mode().Perm() != 0600 || after.Size() != 32 || !before.ModTime().Equal(after.ModTime()) {
		return nil, errors.New("session key changed during verification")
	}
	return key, nil
}

func contributionMAC(key []byte, role string, challenge, nonce []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("contribution-backend-v1:" + role))
	mac.Write(challenge)
	mac.Write(nonce)
	return mac.Sum(nil)
}
func contributionWrite(conn net.Conn, data []byte) error {
	for len(data) > 0 {
		n, err := conn.Write(data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}
func contributionAuthenticateServer(conn net.Conn, key []byte) error {
	if err := conn.SetDeadline(time.Now().Add(contributionAuthTimeout)); err != nil {
		return err
	}
	defer conn.SetDeadline(time.Time{})
	challenge := make([]byte, 32)
	if _, err := rand.Read(challenge); err != nil {
		return err
	}
	if err := contributionWrite(conn, challenge); err != nil {
		return err
	}
	reply := make([]byte, 64)
	if _, err := io.ReadFull(conn, reply); err != nil {
		return err
	}
	if !hmac.Equal(reply[32:], contributionMAC(key, "client", challenge, reply[:32])) {
		return errors.New("backend client authentication failed")
	}
	return contributionWrite(conn, contributionMAC(key, "server", challenge, reply[:32]))
}
func contributionAuthenticateClient(conn net.Conn, key []byte) error {
	if err := conn.SetDeadline(time.Now().Add(contributionAuthTimeout)); err != nil {
		return err
	}
	defer conn.SetDeadline(time.Time{})
	challenge := make([]byte, 32)
	if _, err := io.ReadFull(conn, challenge); err != nil {
		return err
	}
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	if err := contributionWrite(conn, append(nonce, contributionMAC(key, "client", challenge, nonce)...)); err != nil {
		return err
	}
	response := make([]byte, 32)
	if _, err := io.ReadFull(conn, response); err != nil {
		return err
	}
	if !hmac.Equal(response, contributionMAC(key, "server", challenge, nonce)) {
		return errors.New("backend server authentication failed")
	}
	return nil
}
func ContributionAuthenticateClient(conn net.Conn) error {
	key, err := ContributionSessionSecret()
	if err != nil {
		return err
	}
	return contributionAuthenticateClient(conn, key)
}

type contributionListener struct {
	net.Listener
	key []byte
}

func (listener *contributionListener) Accept() (net.Conn, error) {
	for {
		conn, err := listener.Listener.Accept()
		if err != nil {
			return nil, err
		}
		if contributionAuthenticateServer(conn, listener.key) == nil {
			return conn, nil
		}
		conn.Close()
	}
}

// The data proxy stays loopback-only and requires mutual authentication before
// accepting an upstream address/port preamble. No session secret is sent on wire.
func ContributionPrivateListener(port int) (net.Listener, error) {
	key, err := ContributionSessionSecret()
	if err != nil {
		return nil, err
	}
	if port < 0 || port > 65535 {
		return nil, errors.New("invalid private proxy port")
	}
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return nil, err
	}
	return &contributionListener{Listener: listener, key: key}, nil
}
func contributionControlListener() (net.Listener, error) {
	directory, err := contributionState()
	if err != nil {
		return nil, err
	}
	key, err := ContributionSessionSecret()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(directory, "control.sock")
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		return nil, errors.New("a retained backend control socket requires reconciliation")
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0600); err != nil {
		listener.Close()
		return nil, err
	}
	return &contributionListener{Listener: listener, key: key}, nil
}
func ContributionServeControl(handler http.Handler) error {
	listener, err := contributionControlListener()
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 16 * 1024}
	return server.Serve(listener)
}

// URLs retain upstream endpoint syntax, but every control request goes through
// this exact owned Unix socket, never a caller-selected network host or proxy.
func ContributionControlTransport() http.RoundTripper {
	return &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		directory, err := contributionState()
		if err != nil {
			return nil, err
		}
		key, err := ContributionSessionSecret()
		if err != nil {
			return nil, err
		}
		path := filepath.Join(directory, "control.sock")
		before, err := os.Lstat(path)
		if err != nil || before.Mode()&os.ModeSocket == 0 || before.Mode().Perm() != 0600 {
			return nil, errors.New("private backend control socket is unavailable")
		}
		stat, ok := before.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != uint32(os.Getuid()) {
			return nil, errors.New("backend socket has another owner")
		}
		conn, err := (&net.Dialer{Timeout: contributionAuthTimeout}).DialContext(ctx, "unix", path)
		if err != nil {
			return nil, err
		}
		after, err := os.Lstat(path)
		if err != nil || !os.SameFile(before, after) {
			conn.Close()
			return nil, errors.New("backend socket changed during connection")
		}
		if err := contributionAuthenticateClient(conn, key); err != nil {
			conn.Close()
			return nil, err
		}
		return conn, nil
	}, MaxIdleConns: 2, MaxIdleConnsPerHost: 2, ResponseHeaderTimeout: 10 * time.Second}
}

// Optional startup guard for the research executable. The product still needs
// its fixed scoped dispatcher; possession of this private key is not an app grant.
func ContributionRequirePrivateTransport() error {
	key, err := ContributionSessionSecret()
	if err != nil {
		return err
	}
	if bytes.Equal(key, make([]byte, 32)) {
		return errors.New("a fresh random backend session key is required")
	}
	for _, entry := range os.Environ() {
		name := strings.SplitN(entry, "=", 2)[0]
		if strings.HasPrefix(name, "GO_IOS_") || name == "USBMUXD_SOCKET_ADDRESS" {
			os.Unsetenv(name)
		}
	}
	return contributionRequireCommand(os.Args[1:])
}

func contributionRequireCommand(args []string) error {
	if len(args) == 2 && args[0] == "tunnel" && (args[1] == "ls" || args[1] == "stopagent") {
		return nil
	}
	device := regexp.MustCompile(`^[A-Za-z0-9-]{8,128}$`)
	if len(args) == 4 && args[0] == "tunnel" && args[1] == "stop" && args[2] == "--udid" && device.MatchString(args[3]) {
		return nil
	}
	if len(args) == 7 && args[0] == "tunnel" && args[1] == "start" && args[2] == "--userspace" && args[3] == "--udid" && device.MatchString(args[4]) && args[5] == "--pair-record-path" {
		directory, err := contributionState()
		if err != nil {
			return err
		}
		path := filepath.Join(directory, "pairings")
		if args[6] != path {
			return errors.New("only the owned pairing directory is supported")
		}
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
			return errors.New("private pairing directory is not prepared")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != uint32(os.Getuid()) {
			return errors.New("pairing directory has another owner")
		}
		return nil
	}
	return errors.New("research backend permits only an explicit per-device userspace tunnel, private observation, or owned cleanup; all other commands are disabled")
}
