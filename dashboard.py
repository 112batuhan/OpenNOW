import sys
import subprocess
import threading
import time
import os
from datetime import datetime

from PyQt6.QtWidgets import (
    QApplication,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QTextEdit,
    QLabel,
    QScrollArea,
    QFrame,
)
from PyQt6.QtCore import QTimer, pyqtSignal


NUM_PROFILES = 20
AUTO_START_INTERVAL_MS = 20 * 1000


def ts():
    return datetime.now().strftime("%H:%M:%S")


# ===============================================================
# LOG WINDOW
# ===============================================================
class LogWindow(QWidget):
    def __init__(self, profile, logs):
        super().__init__()
        self.setWindowTitle(f"Logs for Profile {profile}")
        self.setGeometry(300, 200, 800, 600)

        layout = QVBoxLayout()
        self.log_view = QTextEdit()
        self.log_view.setReadOnly(True)

        for line in logs:
            self.log_view.append(line)

        layout.addWidget(self.log_view)
        self.setLayout(layout)

    def append_line(self, text):
        self.log_view.append(text)
        self.log_view.verticalScrollBar().setValue(
            self.log_view.verticalScrollBar().maximum()
        )


# ===============================================================
# BOT WIDGET
# ===============================================================
class BotWidget(QFrame):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(str, str)
    timer_signal = pyqtSignal(str)
    stopped_signal = pyqtSignal()

    def __init__(self, profile_number):
        super().__init__()

        self.profile = profile_number
        self.process = None
        self.logs = []
        self.log_window = None

        self.timer_seconds = 0
        self.queue_start_time = None

        # ================= UI =================
        main = QHBoxLayout()

        self.title = QLabel(f"🖥️ Profile {self.profile}")
        main.addWidget(self.title)

        self.status_label = QLabel("STOPPED")
        main.addWidget(self.status_label)

        self.timer_label = QLabel("00:00:00")
        main.addWidget(self.timer_label)

        self.log_preview = QLabel("...")
        main.addWidget(self.log_preview, stretch=1)

        self.start_btn = QPushButton("▶️")
        self.stop_btn = QPushButton("⏹️")
        self.restart_btn = QPushButton("🔄")
        self.viewlog_btn = QPushButton("📜")

        for b in (self.start_btn, self.stop_btn, self.restart_btn, self.viewlog_btn):
            main.addWidget(b)

        self.setLayout(main)

        # ================= SIGNALS =================
        self.log_signal.connect(self._append_log_ui)
        self.status_signal.connect(self._set_status_ui)
        self.timer_signal.connect(self.timer_label.setText)
        self.stopped_signal.connect(self._on_stopped_ui)

        # ================= TIMER =================
        self.qt_timer = QTimer()
        self.qt_timer.timeout.connect(self._update_timer)

        # ================= BUTTONS =================
        self.start_btn.clicked.connect(self.start_bot)
        self.stop_btn.clicked.connect(self.stop_bot)
        self.restart_btn.clicked.connect(self.restart_bot)
        self.viewlog_btn.clicked.connect(self.open_log_window)

    # ---------------- UI SAFE ----------------
    def _append_log_ui(self, line):
        self.logs.append(line)
        self.log_preview.setText(line[:60])
        if self.log_window:
            self.log_window.append_line(line)

    def _set_status_ui(self, text, color):
        self.status_label.setText(text)
        self.status_label.setStyleSheet(f"color: {color}; font-weight: bold;")

    def _on_stopped_ui(self):
        self.qt_timer.stop()
        self.timer_seconds = 0
        self.timer_label.setText("00:00:00")
        self.status_label.setText("STOPPED")

    # ---------------- TIMER ----------------
    def _update_timer(self):
        self.timer_seconds += 1
        h = self.timer_seconds // 3600
        m = (self.timer_seconds % 3600) // 60
        s = self.timer_seconds % 60
        self.timer_label.setText(f"{h:02d}:{m:02d}:{s:02d}")

    # ---------------- PROCESS OUTPUT ----------------
    def read_output(self):
        try:
            for raw in self.process.stdout:
                clean = raw.strip()
                if not clean:
                    continue

                self.log_signal.emit(f"[{ts()}] {clean}")

                if "Waiting in the queue" in clean:
                    self.queue_start_time = time.time()

                if "Game start complete" in clean:
                    if self.queue_start_time:
                        waited = int(time.time() - self.queue_start_time)
                        self.log_signal.emit(
                            f"[{ts()}] Queue wait time: {waited // 60:02d}:{waited % 60:02d}"
                        )
                        self.queue_start_time = None

                    self.timer_seconds = 0
                    self.qt_timer.start(1000)
                    self.status_signal.emit("RUNNING", "lime")

        except Exception as e:
            self.log_signal.emit(f"[{ts()}] ERROR: {e}")

        finally:
            code = self.process.poll()
            self.log_signal.emit(f"[{ts()}] Bot exited (code {code})")

            self.process = None
            self.stopped_signal.emit()

    # ---------------- CONTROL ----------------
    def start_bot(self):
        if self.process:
            return

        user_name = os.environ.get("USERNAME")
        exe_path = (
            rf"C:\Users\{user_name}\AppData\Local\Programs\opennow-stable\OpenNOW.exe"
        )

        self.log_signal.emit(f"[{ts()}] Starting bot...")

        try:
            self.process = subprocess.Popen(
                [exe_path, f"--profile-index={self.profile}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                cwd=os.path.dirname(exe_path),
            )
        except Exception as e:
            self.log_signal.emit(f"[{ts()}] Failed to start: {e}")
            return

        self.status_signal.emit("WAITING", "orange")

        threading.Thread(target=self.read_output, daemon=True).start()

    def stop_bot(self):
        if self.process:
            self.log_signal.emit(f"[{ts()}] Stopping bot...")
            try:
                self.process.terminate()
                self.process.wait(timeout=5)
            except:
                self.process.kill()

    def restart_bot(self):
        self.stop_bot()
        self.logs.clear()
        self.start_bot()

    def is_running(self):
        return self.process is not None

    def open_log_window(self):
        if not self.log_window:
            self.log_window = LogWindow(self.profile, self.logs)
        self.log_window.show()
        self.log_window.raise_()


# ===============================================================
# MAIN WINDOW
# ===============================================================
class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("SeedMe Dashboard")

        self.widgets = []

        self.auto_btn = QPushButton("Auto OFF")
        self.auto_btn.setCheckable(True)
        self.auto_btn.clicked.connect(self.toggle_auto)

        self.auto_timer = QTimer()
        self.auto_timer.timeout.connect(self.auto_start_next)

        top = QHBoxLayout()
        top.addWidget(self.auto_btn)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)

        container = QWidget()
        layout = QVBoxLayout()

        for i in range(1, NUM_PROFILES + 1):
            w = BotWidget(i)
            self.widgets.append(w)
            layout.addWidget(w)

        container.setLayout(layout)
        scroll.setWidget(container)

        root = QVBoxLayout()
        root.addLayout(top)
        root.addWidget(scroll)

        self.setLayout(root)

    def toggle_auto(self):
        if self.auto_btn.isChecked():
            self.auto_btn.setText("Auto ON")
            self.auto_timer.start(AUTO_START_INTERVAL_MS)
            self.auto_start_next()
        else:
            self.auto_btn.setText("Auto OFF")
            self.auto_timer.stop()

    def auto_start_next(self):
        for w in self.widgets:
            if not w.is_running():
                w.start_bot()
                break


# ===============================================================
# RUN
# ===============================================================
def main():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
