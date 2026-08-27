from django.contrib import admin

from .models import AccessKey


@admin.register(AccessKey)
class AccessKeyAdmin(admin.ModelAdmin):
    list_display = ("label", "scope", "revoked", "key", "created_at", "last_used_at")
    list_filter = ("scope", "revoked")
    search_fields = ("label", "key")
    readonly_fields = ("created_at", "last_used_at")
