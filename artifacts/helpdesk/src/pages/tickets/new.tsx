import { useState } from "react";
import { useLocation } from "wouter";
import { 
  useCreateTicket, 
  useListTenants, 
  useGetMe,
  TicketPriority
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";

const ticketSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  priority: z.enum(["baja", "media", "alta", "urgente"] as const).optional(),
  category: z.string().optional(),
  tenantId: z.coerce.number().optional(),
});

type TicketFormValues = z.infer<typeof ticketSchema>;

export default function NewTicket() {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe();
  
  const { data: tenants } = useListTenants({ limit: 100 }, { 
    query: { enabled: user?.role === 'superadmin' } 
  });

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      title: "",
      description: "",
      priority: "media",
      category: "general",
      tenantId: user?.role !== 'superadmin' ? user?.tenantId : undefined,
    },
  });

  const createMutation = useCreateTicket({
    mutation: {
      onSuccess: (data) => {
        setLocation(`/tickets/${data.id}`);
      }
    }
  });

  function onSubmit(data: TicketFormValues) {
    const payload = {
      ...data,
      tenantId: user?.role === 'superadmin' ? data.tenantId! : (user?.tenantId as number),
    };
    createMutation.mutate({ data: payload });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => setLocation("/tickets")} className="gap-2 -ml-4 text-slate-500">
        <ArrowLeft className="h-4 w-4" />
        Back to Tickets
      </Button>

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Create Ticket</h1>
        <p className="text-slate-500 mt-1">Submit a new support request or incident.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card>
            <CardHeader>
              <CardTitle>Ticket Details</CardTitle>
              <CardDescription>Provide as much context as possible to help us resolve this quickly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {user?.role === 'superadmin' && (
                <FormField
                  control={form.control}
                  name="tenantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client / Tenant *</FormLabel>
                      <Select 
                        onValueChange={(v) => field.onChange(parseInt(v, 10))} 
                        defaultValue={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a client" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {tenants?.data.map(t => (
                            <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject *</FormLabel>
                    <FormControl>
                      <Input placeholder="Short summary of the issue" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="general">General Support</SelectItem>
                          <SelectItem value="hardware">Hardware Issue</SelectItem>
                          <SelectItem value="software">Software/App Issue</SelectItem>
                          <SelectItem value="network">Network/Connectivity</SelectItem>
                          <SelectItem value="access">Access/Accounts</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={TicketPriority.baja}>Low</SelectItem>
                          <SelectItem value={TicketPriority.media}>Medium</SelectItem>
                          <SelectItem value={TicketPriority.alta}>High</SelectItem>
                          <SelectItem value={TicketPriority.urgente}>Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description *</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Please describe the issue in detail..." 
                        className="min-h-[200px] resize-y" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 px-6 py-4 rounded-b-xl border-t">
              <Button type="button" variant="outline" onClick={() => setLocation("/tickets")}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Ticket
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}
