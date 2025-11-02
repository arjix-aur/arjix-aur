```
 _________________________________
/ Automated builds for select AUR \
\ packages                        /
 ---------------------------------
        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||
```

## Usage

Add the following to your `/etc/pacman.conf`
```
[arjix-aur]
Server = https://github.com/arjix-aur/.github/releases/download/latest
SigLevel = PackageOptional
```

After that, you can sync your repositories (`pacman -Sy`) and start using our prebuilt packages!
