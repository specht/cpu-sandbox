# CPU Sandbox

Mit der CPU Sandbox programmiert ihr einen kleinen 8-Bit-Prozessor, den
MiniCPU, in Assembler oder in C. Im Browser seht ihr bei jedem Schritt, was
im Prozessor passiert: Register, Flags, jedes Byte im Speicher, den
Bildschirm und die Geräte.

Ihr arbeitet mit **zwei Git-Repositories**:

| Ordner | Inhalt | Wer ändert es? |
| --- | --- | --- |
| `~/cpu-sandbox/` | die App mit den Beispielen | nur die Lehrkraft |
| `~/cpu-sandbox/programs/` | das **Klassen-Repository** mit euren Programmen | ihr, jeweils im eigenen Unterordner |

## 1. Einmalig: Zugang zu GitLab einrichten

Melde dich auf [git.nhcham.org](https://git.nhcham.org/) an. Erzeuge dann im
Terminal einen SSH-Schlüssel (falls `ls ~/.ssh/id_ed25519.pub` noch keinen
findet; alle Rückfragen mit Enter bestätigen) und zeige ihn an:

```bash
ssh-keygen -t ed25519 -C "Vorname Nachname"
cat ~/.ssh/id_ed25519.pub
```

Kopiere die ganze Zeile, die mit `ssh-ed25519` beginnt, nach GitLab unter
**Edit profile → Access → SSH keys → Add new key**. Die private Datei
`~/.ssh/id_ed25519` gibst du nie weiter. Trage zum Schluss deinen Namen und
deine GitLab-E-Mail-Adresse ein und teste die Verbindung:

```bash
git config --global user.name "Vorname Nachname"
git config --global user.email "deine.mail@example.org"
ssh -T git@git.nhcham.org
```

## 2. App und Klassen-Repository klonen

<!--
  Lehrkraft: Jedes Schuljahr nur die URL des Klassen-Repositorys in der
  letzten Zeile des folgenden Blocks anpassen. Alles andere bleibt gleich.
-->

```bash
cd ~
git clone https://github.com/specht/cpu-sandbox.git
cd cpu-sandbox
git clone git@git.nhcham.org:specht/cpu-sandbox-programs-2026.git programs
```

Das Klassen-Repository muss **in** der App liegen und genau `programs`
heißen. Existiert `programs/` schon, klone es nicht noch einmal und lösche
nichts, sondern frag nach.

## 3. Die App starten

Du brauchst Node.js (Version 18 oder neuer), sonst nichts.

```bash
cd ~/cpu-sandbox
./run
```

Öffne dann im Browser **http://127.0.0.1:8765**. Lass dieses Terminal offen
und verwende für Git ein zweites.

Der Knopf mit Sonne bzw. Mond oben rechts wechselt zwischen dunklem und hellem
Design. Die App merkt sich die Wahl in der Datei `.settings.yaml` im
App-Ordner; Git ignoriert sie, sie landet also in keinem Repository.

## 4. Dein erstes Programm

Links oben wählst du ein Programm. Unter **Examples** liegen die Beispiele,
von `01-add.asm` (zwei Zahlen addieren) bis `26-landscape.c` (Berge, die sich
in einem See spiegeln).
Sie lassen sich nicht verändern; **Save copy** speichert eine Kopie in deinem
Ordner, die du dann bearbeiten kannst.

Ein neues Programm legst du mit **+** neben der Programmauswahl an: Gib als
**Student folder** deinen Ordnernamen an (zum Beispiel `anna`), dann einen
Dateinamen, die Sprache (Assembler oder C) und die CPU. Unter **Task** kannst
du eine Aufgabe wählen (siehe Schritt 6). Das Programm entsteht in
`programs/DEIN_NAME/` und öffnet sich sofort.

## 5. Bearbeiten und ausprobieren

- **Speichern** mit **Ctrl+S**. Die App übersetzt dein Programm schon beim
  Tippen; Fehler erscheinen unter dem Editor, ein Klick springt in die Zeile.
- Links neben dem Code stehen die **Adresse und die Bytes** jeder Zeile: So
  sieht dein Programm im Speicher aus. **Bytes** unter dem Editor blendet
  diese Spalte aus und wieder ein.
- Unten steuerst du die CPU: **Run** (Leertaste), **Step** (→) führt einen
  Befehl aus, **Step back** (←) macht ihn rückgängig, **Restart** (Pos1)
  beginnt von vorn. Der **Clock**-Regler stellt die Taktfrequenz ein, von
  1 Hz (zum Zusehen) bis 64 MHz.
- Ein Klick auf eine **Zeilennummer** setzt einen Haltepunkt.
- **Cycles** neben den Schritt-Knöpfen zeigt, was in einem Befehl Takt für
  Takt passiert: Mit → holt die CPU das erste Byte (Fetch), erkennt den
  Befehl (Decode), holt die weiteren Bytes, liest oder schreibt den Speicher
  und springt. Ein kleines Bild zeigt dabei Adressbus und Datenbus.
- Ein Klick auf ein **Register** zeigt alle Register binär statt
  hexadezimal. Fährst du über ein Register, siehst du den Wert auch mit
  Vorzeichen; über **ZF** und **CF** erklärt die App, warum der letzte Befehl
  das Flag gesetzt oder gelöscht hat.
- Rechts siehst du die **Register**, die **Geräte** (Joystick, Zahlenanzeige,
  Lautsprecher, …), den **Bildschirm** und den **Speicher (RAM)**. Fährst du
  mit der Maus über ein Byte, erklärt die App, was es ist. Ein Klick auf ein
  Byte deines Programms springt im Editor zu seiner Zeile.
- Klickst du auf den Bildschirm, gehen die Tasten an dein Programm
  (Pfeiltasten, Leertaste, Tastatur); **Esc** gibt sie zurück.
- **Documentation** oben rechts erklärt alle Befehle der drei CPU-Stufen,
  den Assembler, C, die Geräte, den Bildschirm und die ASCII-Tabelle.

## 6. Aufgaben

Eine Aufgabe sagt, was ein Programm tun soll, und bringt Testfälle mit. Ein
Programm gehört zu einer Aufgabe, wenn in einer seiner ersten Zeilen ihr Name
steht, zum Beispiel `; Task: add` (in C: `// Task: add`). Das erledigt **+**
für dich, wenn du dort eine Aufgabe wählst.

Die Aufgabe steht dann als Kommentar oben in deinem Programm, darunter, wo
die Eingabe liegt (**Input**), wohin das Ergebnis gehört (**Result**) und ein
Beispiel. Die Aufgabentexte sind auf Englisch, wie alles in der App.
**Check** prüft dein Programm mit
allen Testfällen und zeigt, was nicht stimmt, etwa
`0x82 should be 7, but it is 8`. **Try it** lädt einen Testfall in die
Maschine: Seine Eingabe steht dann im Speicher, und du kannst Schritt für
Schritt verfolgen, was passiert.

Die ersten elf Aufgaben löst du zuerst in Assembler auf der MiniCPU 8 und
später noch einmal in C: Wähle bei **+** die Sprache C, dann liegen die
Eingaben ab 0x8000 auf der MiniCPU 8X. Im Vergleich siehst du, was C kostet:
mehr Bytes und meist mehr Takte, dafür ist das Programm viel schneller
geschrieben. Fünf weitere Aufgaben (Rekursion, ggT, Primzahlen, Buchstaben
zählen, Linien zeichnen) sind nur für C gedacht.

**Class progress** oben rechts zeigt den Stand der ganzen Klasse. Ein Klick
auf eine Aufgabe vergleicht die fertigen Lösungen: Wer braucht die wenigsten
Takte, wessen Programm ist am kleinsten? Alle Aufgaben stehen in
[docs/tasks.md](docs/tasks.md).

## 7. Veröffentlichen

```bash
cd ~/cpu-sandbox/programs
git pull
git add DEIN_NAME/
git commit -m "Aufgabe add von DEIN_NAME"
git push
```

Füge nur Dateien aus deinem eigenen Ordner hinzu. Lehnt Git den Push ab,
lösche nichts und frag nach. Was andere veröffentlichen, erscheint nach
`git pull` nach wenigen Sekunden in der App.

## 8. Beim nächsten Mal

```bash
cd ~/cpu-sandbox && git pull
cd programs && git pull
cd .. && ./run
```

## Häufige Probleme

- **`Permission denied (publickey)`**: Der SSH-Schlüssel fehlt in GitLab
  (Schritt 1).
- **„There is no class repository yet“**: `programs/` fehlt oder liegt am
  falschen Ort (Schritt 2).
- **`node: command not found`**: Node.js ist nicht installiert.
- **„The file changed on disk“**: Die Datei wurde außerhalb der App geändert,
  etwa durch `git pull`. **Revert** lädt die neue Fassung; deine Änderungen
  gehen dabei verloren.
- **Die Tasten kommen nicht im Programm an**: Klicke auf den Bildschirm.

Mehr: [docs/teaching.md](docs/teaching.md) (die Beispiele in Kapiteln, mit
Fragen und den passenden Aufgaben), [docs/cpu-levels.md](docs/cpu-levels.md) (die drei CPU-Stufen),
[docs/minic.md](docs/minic.md) (C für die MiniCPU),
[docs/devices.md](docs/devices.md) (die Geräte),
[docs/screen.md](docs/screen.md) (der Bildschirm),
[DEVELOPMENT.md](DEVELOPMENT.md) (Technik).
