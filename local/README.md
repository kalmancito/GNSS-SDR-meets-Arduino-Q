# Site-specific provisioning

Files placed here are baked into the image at build time and are **never
committed** (everything in this directory except this file is ignored by git).

| File | Effect in the image |
|---|---|
| `authorized_keys` | Installed as root's `~/.ssh/authorized_keys` (mode 0600). SSH public keys, one per line. This is the only way to log in to a product image. |
| `wifi.nmconnection` | Installed in `/etc/NetworkManager/system-connections/` (mode 0600): the board joins this Wi-Fi network on first boot. |

If `authorized_keys` is missing, the product build warns that nobody will be
able to log in. For bring-up, build with `scripts/build-gnss-image.sh --debug`
instead (password-less root; not for deployment).

## `authorized_keys`

```bash
cp ~/.ssh/id_ed25519.pub local/authorized_keys
```

## `wifi.nmconnection`

```ini
[connection]
id=receiver-wifi
type=wifi
autoconnect=true

[wifi]
mode=infrastructure
ssid=YOUR-NETWORK-NAME

[wifi-security]
key-mgmt=wpa-psk
psk=YOUR-PASSPHRASE

[ipv4]
method=auto

[ipv6]
method=auto
```

The passphrase ends up in clear text inside the image: treat the built image
as a secret too, or provision Wi-Fi after the first boot instead
(`nmcli device wifi connect <ssid> password <passphrase>` over the serial
console).
