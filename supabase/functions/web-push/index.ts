import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-ozk-push-token",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

function bearer(req: Request) {
  const value = req.headers.get("authorization") || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export default {
  async fetch(req: Request) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !serviceKey) return json({ error: "server_not_configured" }, 500);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
    const action = String(body.action || "");

    async function requireUser() {
      const token = bearer(req);
      if (!token) return null;
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return null;
      return data.user;
    }

    async function readSecret(name: string) {
      const { data, error } = await admin.from("app_secrets").select("value").eq("name", name).maybeSingle();
      if (error) throw error;
      return String(data?.value || "");
    }

    if (action === "config" || action === "public-key") {
      const user = await requireUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      const publicKey = await readSecret("web_push_vapid_public_key");
      if (!publicKey) return json({ error: "vapid_not_configured" }, 503);
      return json({ publicKey });
    }

    if (action === "subscribe") {
      const user = await requireUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      const subscription = body.subscription as Record<string, unknown> | undefined;
      const keys = subscription?.keys as Record<string, unknown> | undefined;
      const endpoint = String(subscription?.endpoint || "");
      const p256dh = String(keys?.p256dh || "");
      const authKey = String(keys?.auth || "");
      if (!endpoint || !p256dh || !authKey || !endpoint.startsWith("https://")) {
        return json({ error: "invalid_subscription" }, 400);
      }

      const { error } = await admin.from("web_push_subscriptions").upsert({
        user_id: user.id,
        endpoint,
        p256dh,
        auth_key: authKey,
        user_agent: String(req.headers.get("user-agent") || "").slice(0, 500),
        enabled: true,
        updated_at: new Date().toISOString(),
        last_error: null,
      }, { onConflict: "endpoint" });
      if (error) return json({ error: "subscription_save_failed" }, 500);
      return json({ ok: true });
    }

    if (action === "unsubscribe") {
      const user = await requireUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      const endpoint = String(body.endpoint || "");
      if (!endpoint) return json({ error: "endpoint_required" }, 400);
      const { error } = await admin.from("web_push_subscriptions")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("endpoint", endpoint);
      if (error) return json({ error: "unsubscribe_failed" }, 500);
      return json({ ok: true });
    }

    if (action === "test") {
      const user = await requireUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      const { data: subscriptions, error } = await admin.from("web_push_subscriptions")
        .select("id,endpoint,p256dh,auth_key")
        .eq("user_id", user.id)
        .eq("enabled", true);
      if (error) return json({ error: "test_subscription_load_failed" }, 500);
      if (!subscriptions?.length) return json({ error: "no_active_subscriptions" }, 409);

      const vapidPublic = await readSecret("web_push_vapid_public_key");
      const vapidPrivate = await readSecret("web_push_vapid_private_key");
      if (!vapidPublic || !vapidPrivate) return json({ error: "vapid_not_configured" }, 503);
      webpush.setVapidDetails("mailto:admin@ozktobacco.com", vapidPublic, vapidPrivate);

      const payload = JSON.stringify({
        web_push: 8030,
        notification: {
          title: "🔔 اختبار إشعارات OZK",
          body: "الإشعارات الفورية مفعّلة على هذا الجهاز.",
          navigate: "https://ozktobacco.com/?route=overview",
          tag: "push-test",
          lang: "ar",
          dir: "rtl",
          icon: "https://ozktobacco.com/public/icons/ozk-ios-full-notification-icon.png",
          app_badge: "1",
        },
      });

      let sent = 0;
      let failed = 0;
      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
          }, payload, { TTL: 300, urgency: "high" });
          sent++;
          await admin.from("web_push_subscriptions")
            .update({ last_success_at: new Date().toISOString(), last_error: null })
            .eq("id", subscription.id);
        } catch (pushError) {
          failed++;
          const statusCode = Number((pushError as { statusCode?: number })?.statusCode || 0);
          const lastError = String((pushError as Error)?.message || "push_failed").slice(0, 500);
          await admin.from("web_push_subscriptions")
            .update(statusCode === 404 || statusCode === 410
              ? { enabled: false, last_error: `expired:${statusCode}` }
              : { last_error: lastError })
            .eq("id", subscription.id);
        }
      }

      if (sent === 0) return json({ error: "test_delivery_failed", sent, failed }, 502);
      return json({ ok: true, sent, failed });
    }

    if (action === "dispatch") {
      const supplied = req.headers.get("x-ozk-push-token") || "";
      const expected = await readSecret("web_push_dispatch_token");
      if (!expected || supplied.length < 32 || supplied !== expected) return json({ error: "unauthorized" }, 401);

      const vapidPublic = await readSecret("web_push_vapid_public_key");
      const vapidPrivate = await readSecret("web_push_vapid_private_key");
      if (!vapidPublic || !vapidPrivate) return json({ error: "vapid_not_configured" }, 503);
      webpush.setVapidDetails("mailto:admin@ozktobacco.com", vapidPublic, vapidPrivate);

      const [{ data: messages, error: messageError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
        admin.from("web_push_outbox").select("id,event_type,title,body,tag,navigate,attempts").eq("status", "pending").order("created_at").limit(20),
        admin.from("web_push_subscriptions").select("id,endpoint,p256dh,auth_key").eq("enabled", true),
      ]);
      if (messageError || subscriptionError) return json({ error: "load_failed" }, 500);

      let sent = 0;
      let failed = 0;
      for (const message of messages || []) {
        if (!subscriptions?.length) {
          await admin.from("web_push_outbox").update({ status: "failed", attempts: Number(message.attempts || 0) + 1, last_error: "no_active_subscriptions" }).eq("id", message.id);
          failed++;
          continue;
        }

        let messageSuccess = 0;
        let lastError = "";
        const payload = JSON.stringify({
          web_push: 8030,
          notification: {
            title: message.title,
            body: message.body,
            navigate: `https://ozktobacco.com${message.navigate || "/?route=overview"}`,
            tag: message.tag || message.event_type,
            lang: "ar",
            dir: "rtl",
            icon: "https://ozktobacco.com/public/icons/ozk-ios-full-notification-icon.png",
            app_badge: "1",
          },
        });

        for (const sub of subscriptions) {
          try {
            await webpush.sendNotification({
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_key },
            }, payload, { TTL: 300, urgency: "high" });
            messageSuccess++;
            await admin.from("web_push_subscriptions").update({ last_success_at: new Date().toISOString(), last_error: null }).eq("id", sub.id);
          } catch (error) {
            const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
            lastError = String((error as Error)?.message || "push_failed").slice(0, 500);
            if (statusCode === 404 || statusCode === 410) {
              await admin.from("web_push_subscriptions").update({ enabled: false, last_error: `expired:${statusCode}` }).eq("id", sub.id);
            } else {
              await admin.from("web_push_subscriptions").update({ last_error: lastError }).eq("id", sub.id);
            }
          }
        }

        if (messageSuccess > 0) {
          await admin.from("web_push_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: Number(message.attempts || 0) + 1, last_error: null }).eq("id", message.id);
          sent++;
        } else {
          await admin.from("web_push_outbox").update({ status: "failed", attempts: Number(message.attempts || 0) + 1, last_error: lastError || "all_subscriptions_failed" }).eq("id", message.id);
          failed++;
        }
      }
      return json({ ok: true, sent, failed });
    }

    return json({ error: "unknown_action" }, 400);
  },
};
