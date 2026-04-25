Output assets/demo.gif

Set Shell "zsh"
Set FontSize 14
Set Width 1100
Set Height 550
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set Padding 24

Hide
Type "export PATH=/opt/homebrew/bin:/Users/evan/.nvm/versions/node/v22.16.0/bin:$PATH"
Enter
Sleep 300ms
Type "bash /Users/evan/dev/playground/firma/assets/setup-demo-db.sh"
Enter
Sleep 500ms
Type "firma config set db-path ~/.firma/demo.db"
Enter
Sleep 300ms
Type "clear"
Enter
Sleep 300ms
Show

Sleep 500ms

Type "firma show portfolio"
Sleep 300ms
Enter
Sleep 5s

Type "firma show earnings"
Sleep 300ms
Enter
Sleep 6s

Hide
Type "firma config set db-path ~/.firma/firma.db"
Enter
Sleep 300ms
