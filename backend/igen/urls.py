from django.urls import path
from .views import generate_image, job_status, metrics_summary, metrics_jobs, verify_key

urlpatterns = [
    path("generate/", generate_image, name="generate_image"),
    path("status/<str:job_id>/", job_status, name="job_status"),
    path("metrics/summary/", metrics_summary, name="metrics_summary"),
    path("metrics/jobs/", metrics_jobs, name="metrics_jobs"),
    path("verify-key/", verify_key, name="verify_key"),
]