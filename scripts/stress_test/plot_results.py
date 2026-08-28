"""
2x2 plot of stress_test.py's summary.csv against arrival rate (jobs/sec).

x-axis is arrival rate (1/mean_interarrival), not mean_interarrival itself,
so "more load" reads left-to-right instead of backwards.

Panels:
  1. Blocking probability -- own scale (0-1), incompatible with the
     seconds-based panels, so it stays separate rather than sharing an axis.
  2. Offered/admitted/rejected -- stacked bar, same unit (jobs), and
     offered = admitted + rejected + submit_errors, so stacking is a
     literal decomposition, not just a convenient overlay.
  3 & 4. Avg / p95 latency components (wait, service, total) -- all
     seconds and total = wait + service, so overlaying them shows how
     much of total latency growth is wait vs. service directly.

Usage: python plot_results.py [path/to/summary.csv]
"""

import csv
import os
import sys

import matplotlib.pyplot as plt
from matplotlib import cm
from matplotlib.colors import Normalize

RESULTS_DIR = os.path.dirname(__file__)


def load_rows(csv_path):
    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    rows.sort(key=lambda r: float(r["mean_interarrival_seconds"]), reverse=True)  # ascending load
    for r in rows:
        for k, v in r.items():
            r[k] = float(v) if k != "mean_interarrival_seconds" else float(v)
    return rows


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RESULTS_DIR, "results", "summary.csv")
    rows = load_rows(csv_path)

    arrival_rate = [1 / r["mean_interarrival_seconds"] for r in rows]
    labels = [f"{r['mean_interarrival_seconds']:g}s" for r in rows]

    fig, axes = plt.subplots(2, 2, figsize=(13, 9))
    fig.suptitle("IGEN JOB QUEUE - STRESS TEST RESULTS", fontsize=15, fontweight="bold")

    # viridis at 3 fixed points for the wait/service/total triad, reused
    # identically on both latency panels so the two are directly comparable.
    wait_c, service_c, total_c = cm.viridis(0.15), cm.viridis(0.55), cm.viridis(0.9)

    # 1. Blocking probability -- bar, not line: these are 5 independent
    # runs, not points on a continuum, so interpolating between them
    # implies a smoothness the data doesn't have. Each bar's own color
    # also encodes its height via plasma (low prob -> dark purple, high
    # prob -> bright yellow), redundant with height but reinforces it.
    ax = axes[0, 0]
    blocking_pct = [r["blocking_probability"] * 100 for r in rows]
    norm = Normalize(vmin=0, vmax=100)
    colors = [cm.plasma(norm(v)) for v in blocking_pct]
    x = range(len(rows))
    bars = ax.bar(x, blocking_pct, color=colors, edgecolor="black", linewidth=0.5)
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_title("Blocking probability")
    ax.set_xlabel("Mean inter-arrival time")
    ax.set_ylabel("Rejected (%)")
    ax.set_ylim(0, 100)
    ax.grid(alpha=0.3, axis="y")
    fig.colorbar(cm.ScalarMappable(norm=norm, cmap="plasma"), ax=ax, label="Rejected (%)")

    # 2. Offered / admitted / rejected -- stacked bar. submit_errors
    # dropped: negligible (1 transient blip across 588 offered jobs) and
    # not part of the admit/reject story this panel is telling.
    ax = axes[0, 1]
    admitted = [r["jobs_admitted"] for r in rows]
    rejected = [r["jobs_rejected"] for r in rows]
    ax.bar(x, admitted, label="admitted", color="seagreen")
    ax.bar(x, rejected, bottom=admitted, label="rejected", color="crimson")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_title("Offered load: admitted vs. rejected")
    ax.set_xlabel("Mean inter-arrival time")
    ax.set_ylabel("Jobs offered")
    ax.legend()
    ax.grid(alpha=0.3, axis="y")

    # 3. Avg latency components -- log scale: service time (~5s) and
    # wait/total (up to ~90s) span more than one order of magnitude, so a
    # linear axis flattens service time to invisibility (as it did in the
    # first version of this plot); log scale keeps all three legible.
    ax = axes[1, 0]
    ax.plot(arrival_rate, [r["avg_wait_seconds"] for r in rows], marker="o", label="avg wait", color=wait_c)
    ax.plot(arrival_rate, [r["avg_service_seconds"] for r in rows], marker="o", label="avg service", color=service_c)
    ax.plot(arrival_rate, [r["avg_total_latency_seconds"] for r in rows], marker="o", label="avg total latency", color=total_c)
    ax.set_yscale("log")
    ax.set_title("Average latency (wait vs. service vs. total)")
    ax.set_xlabel("Arrival rate (jobs/sec)")
    ax.set_ylabel("Seconds (log scale)")
    ax.legend()
    ax.grid(alpha=0.3, which="both")

    # 4. p95 latency components -- same log-scale treatment
    ax = axes[1, 1]
    ax.plot(arrival_rate, [r["p95_wait_seconds"] for r in rows], marker="o", label="p95 wait", color=wait_c)
    ax.plot(arrival_rate, [r["p95_service_seconds"] for r in rows], marker="o", label="p95 service", color=service_c)
    ax.plot(arrival_rate, [r["p95_total_latency_seconds"] for r in rows], marker="o", label="p95 total latency", color=total_c)
    ax.set_yscale("log")
    ax.set_title("p95 latency (wait vs. service vs. total)")
    ax.set_xlabel("Arrival rate (jobs/sec)")
    ax.set_ylabel("Seconds (log scale)")
    ax.legend()
    ax.grid(alpha=0.3, which="both")

    fig.tight_layout(rect=[0, 0, 1, 0.96])
    out_path = os.path.join(os.path.dirname(csv_path), "stress_test_results.png")
    fig.savefig(out_path, dpi=150)
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
