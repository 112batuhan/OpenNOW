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
from PyQt6.QtCore import QTimer

NUM_PROFILES = 20
AUTO_START_INTERVAL_MS = 20 * 1000  # 20 saniye


# ===============================================================
# TIMESTAMP
# ===============================================================
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
        self.log_view.setStyleSheet("""
            background-color: #000;
            color: #0f0;
            font-family: Consolas;
            font-size: 13px;
        """)

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
    def __init__(self, profile_number):
        super().__init__()

        self.profile = profile_number
        self.process = None
        self.logs = []
        self.log_window = None

        self.timer_seconds = 0
        self.timer_stop_request = True
        self.queue_start_time = None

        self.setObjectName("profileCard")
        self.setStyleSheet("""
            QFrame#profileCard {
                background-color: #2a2a2a;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 8px;
            }
        """)

        # ===================== LAYOUT =====================
        main = QHBoxLayout()
        main.setContentsMargins(8, 6, 8, 6)
        main.setSpacing(12)

        self.title = QLabel(f"🖥️ Profile {self.profile}")
        self.title.setStyleSheet(
            "background: transparent; font-size: 15px; font-weight: bold;"
        )
        main.addWidget(self.title)

        self.status_label = QLabel("STOPPED")
        self.status_label.setStyleSheet(
            "background: transparent; color: red; font-weight: bold;"
        )
        main.addWidget(self.status_label)

        self.timer_label = QLabel("00:00:00")
        self.timer_label.setStyleSheet("background: transparent; color: cyan;")
        main.addWidget(self.timer_label)

        self.log_preview = QLabel("...")
        self.log_preview.setStyleSheet(
            "background: transparent; color: #ccc; font-size: 13px;"
        )
        main.addWidget(self.log_preview, stretch=1)

        btns = QHBoxLayout()
        btns.setSpacing(4)

        self.start_btn = QPushButton("▶️")
        self.stop_btn = QPushButton("⏹️")
        self.restart_btn = QPushButton("🔄")
        self.viewlog_btn = QPushButton("📜")

        for btn in (self.start_btn, self.stop_btn, self.restart_btn, self.viewlog_btn):
            btn.setFixedSize(34, 34)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: none;
                    font-size: 20px;
                }
                QPushButton:hover {
                    background: #444;
                    border-radius: 6px;
                }
            """)

        btns.addWidget(self.start_btn)
        btns.addWidget(self.stop_btn)
        btns.addWidget(self.restart_btn)
        btns.addWidget(self.viewlog_btn)

        main.addLayout(btns)
        self.setLayout(main)

        self.start_btn.clicked.connect(self.start_bot)
        self.stop_btn.clicked.connect(self.stop_bot)
        self.restart_btn.clicked.connect(self.restart_bot)
        self.viewlog_btn.clicked.connect(self.open_log_window)

    # ---------------- STATUS ----------------
    def set_status(self, text, color):
        self.status_label.setText(text)
        self.status_label.setStyleSheet(
            f"background: transparent; color: {color}; font-weight: bold;"
        )

    def is_running(self):
        return self.process is not None

    # ---------------- TIMER ----------------
    def timer_loop(self):
        while not self.timer_stop_request:
            time.sleep(1)
            self.timer_seconds += 1
            h = self.timer_seconds // 3600
            m = (self.timer_seconds % 3600) // 60
            s = self.timer_seconds % 60
            self.timer_label.setText(f"{h:02d}:{m:02d}:{s:02d}")

    # ---------------- LOG ----------------
    def append_log(self, text):
        line = f"[{ts()}] {text}"
        self.logs.append(line)
        self.log_preview.setText(text[:60])

        if self.log_window:
            self.log_window.append_line(line)

    # ---------------- PROCESS OUTPUT ----------------
    def read_output(self):
        try:
            for raw in self.process.stdout:
                clean = raw.strip()
                if not clean:
                    continue

                self.append_log(clean)

                if "Waiting in the queue" in clean:
                    self.queue_start_time = time.time()

                if "Game start complete" in clean:
                    if self.queue_start_time:
                        waited = int(time.time() - self.queue_start_time)
                        self.append_log(
                            f"Queue wait time: {waited // 60:02d}:{waited % 60:02d}"
                        )
                        self.queue_start_time = None

                    self.timer_stop_request = False
                    self.timer_seconds = 0
                    threading.Thread(target=self.timer_loop, daemon=True).start()
                    self.set_status("RUNNING", "lime")

        finally:
            self.timer_stop_request = True
            self.timer_seconds = 0
            self.timer_label.setText("00:00:00")
            self.set_status("STOPPED", "red")
            self.append_log("Bot exited.")
            self.process = None

    # ---------------- CONTROL ----------------
    def start_bot(self):
        if self.process:
            return
        self.append_log("Starting bot...")

        user_name = os.environ.get("USERNAME")
        exe_path = (
            rf"C:\Users\{user_name}\AppData\Local\Programs\opennow-stable\OpenNOW.exe"
        )

        self.process = subprocess.Popen(
            [exe_path, "--", f"--profile-index={self.profile}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

        self.set_status("WAITING", "orange")
        threading.Thread(target=self.read_output, daemon=True).start()

    def stop_bot(self):
        if self.process:
            self.append_log("Stopping bot...")
            try:
                self.process.kill()
            except:  # noqa: E722
                pass

    def restart_bot(self):
        self.stop_bot()
        self.logs.clear()
        self.start_bot()

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
        self.setGeometry(200, 50, 1500, 900)
        self.setStyleSheet("background-color: #222;")

        self.widgets = []

        # ---------- AUTO START ----------
        self.auto_btn = QPushButton("⏵ Auto-Start OFF")
        self.auto_btn.setCheckable(True)
        self.auto_btn.clicked.connect(self.toggle_auto)

        self.auto_btn.setStyleSheet("""
            QPushButton {
                background-color: #333;
                color: #ddd;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 6px 14px;
            }
            QPushButton:hover { background-color: #444; }
            QPushButton:checked {
                background-color: #1f6f43;
                color: #eaffea;
                border-color: #2ecc71;
            }
        """)

        self.auto_timer = QTimer()
        self.auto_timer.timeout.connect(self.auto_start_next)

        # ---------- LAYOUT ----------
        top = QHBoxLayout()
        top.addWidget(self.auto_btn)
        top.addStretch()

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)

        container = QWidget()
        cols = QHBoxLayout()
        left, right = QVBoxLayout(), QVBoxLayout()

        for i in range(1, NUM_PROFILES + 1):
            w = BotWidget(i)
            self.widgets.append(w)
            (left if i <= NUM_PROFILES // 2 else right).addWidget(w)

        cols.addLayout(left)
        cols.addLayout(right)
        container.setLayout(cols)
        scroll.setWidget(container)

        root = QVBoxLayout()
        root.addLayout(top)
        root.addWidget(scroll)
        self.setLayout(root)

    # ---------- AUTO START LOGIC ----------
    def toggle_auto(self):
        if self.auto_btn.isChecked():
            self.auto_btn.setText("⏸ Auto-Start ON")
            self.auto_start_next()
            self.auto_timer.start(AUTO_START_INTERVAL_MS)
        else:
            self.auto_btn.setText("⏵ Auto-Start OFF")
            self.auto_timer.stop()

    def auto_start_next(self):
        for w in sorted(self.widgets, key=lambda x: x.profile):
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
