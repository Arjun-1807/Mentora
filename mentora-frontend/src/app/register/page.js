"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { InlineError } from "@/components/StateCard";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { register, tokenFromAuthResponse } from "@/lib/api";
import { setToken } from "@/lib/storage";

const SECTOR_OPTIONS = [
  "Fintech",
  "Healthtech",
  "SaaS",
  "Consumer",
  "Marketplace",
  "AI/ML",
  "Climate",
  "Hardware",
];

const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState("startup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [sectorExpertise, setSectorExpertise] = useState([]);
  const [pastExits, setPastExits] = useState("");
  const [stageFocus, setStageFocus] = useState("");
  const [geography, setGeography] = useState("");
  const [availability, setAvailability] = useState("");

  function toggleSector(sector) {
    setSectorExpertise((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    const profile =
      role === "mentor"
        ? {
            name,
            sector_expertise: sectorExpertise,
            past_exits: pastExits,
            stage_focus: stageFocus,
            geography,
            availability,
          }
        : { name };

    setLoading(true);
    setError("");
    try {
      const data = await register({ email, password, role, profile });
      const token = tokenFromAuthResponse(data);
      if (token) {
        setToken(token);
        toast.success("Account created.");
        router.push("/upload");
      } else {
        toast.success("Account created. Please sign in.");
        router.push("/login");
      }
    } catch (err) {
      setError(err.message || "Could not create account.");
      setLoading(false);
    }
  }

  return (
    <PageShell width="lg" center>
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>Join Mentora as a startup or a mentor.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={role} onValueChange={setRole}>
            <TabsList className="w-full">
              <TabsTrigger value="startup" className="flex-1" disabled={loading}>
                Startup
              </TabsTrigger>
              <TabsTrigger value="mentor" className="flex-1" disabled={loading}>
                Mentor
              </TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit} className="space-y-4 mt-6">
              <div className="space-y-1.5">
                <Label htmlFor="register-name">Name</Label>
                <Input
                  id="register-name"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  aria-describedby="register-password-hint"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <p id="register-password-hint" className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              </div>

              <TabsContent value="mentor" className="space-y-4 mt-0">
                <fieldset className="space-y-1.5" disabled={loading}>
                  <legend className="text-sm font-medium leading-none mb-2">
                    Sector expertise
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {SECTOR_OPTIONS.map((sector) => {
                      const active = sectorExpertise.includes(sector);
                      return (
                        <Badge
                          key={sector}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer select-none px-2.5 py-1 h-auto"
                          render={
                            <button
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleSector(sector)}
                            />
                          }
                        >
                          {sector}
                        </Badge>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="space-y-1.5">
                  <Label htmlFor="past-exits">Past exits</Label>
                  <Input
                    id="past-exits"
                    name="past_exits"
                    placeholder="e.g. 2 (Acme Inc., Foo Corp.)"
                    value={pastExits}
                    onChange={(e) => setPastExits(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="stage-focus">Stage focus</Label>
                  <Select value={stageFocus} onValueChange={setStageFocus}>
                    <SelectTrigger id="stage-focus" className="w-full" disabled={loading}>
                      <SelectValue placeholder="Select a stage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="idea">Idea</SelectItem>
                      <SelectItem value="MVP">MVP</SelectItem>
                      <SelectItem value="growth">Growth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="geography">Geography</Label>
                  <Input
                    id="geography"
                    name="geography"
                    placeholder="e.g. San Francisco, Remote"
                    value={geography}
                    onChange={(e) => setGeography(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="availability">Availability</Label>
                  <Select value={availability} onValueChange={setAvailability}>
                    <SelectTrigger id="availability" className="w-full" disabled={loading}>
                      <SelectValue placeholder="Select availability" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Full-time">Full-time</SelectItem>
                      <SelectItem value="Few hours/week">Few hours/week</SelectItem>
                      <SelectItem value="Ad-hoc">Ad-hoc</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              {error && <InlineError message={error} />}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {loading ? "Creating account…" : "Create Account"}
              </Button>
            </form>
          </Tabs>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
